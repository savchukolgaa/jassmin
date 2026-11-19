// The AI perfumer's saved chats (#180): the chat page's thread, the model's history built from the
// stored messages, saving each turn, "New chat", "Delete chat", ratings and the merge at login.
// `perfumer-chat.ts` (rate limits, the engine, analytics) reaches these through its store, so its
// unit tests need no database. Message text stays in `perfumer_*`: never in `user_events`.
import {
  MAX_PERFUMER_TURN,
  PERFUMER_MAX_MESSAGES,
  PERFUMER_MAX_THREAD_ITEMS,
  type PerfumerEntry,
  type PerfumerMessage,
  type PerfumerPick,
  type PerfumerRating,
  type PerfumerReply,
  type PerfumerThreadView,
  replyToHistoryText,
  type ThreadItem,
} from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { ensureVisitor, type RequestArgs, readVisitor } from "../analytics";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import {
  closeActiveThread,
  countUserMessages,
  deleteMessage,
  findActiveThread,
  insertUserMessage,
  listRecentMessages,
  lockOrCreateActiveThread,
  moveGuestThreadToUser,
  type PerfumerMessageRow,
  type PerfumerOwner,
  type PerfumerTurnEnd,
  saveTurnEnd,
  setReplyRating,
  softDeleteActiveThread,
  touchThread,
} from "../db/queries/perfumer-chats";
import { parseStoredPerfumerReply } from "./perfumer-chat.schema";
import { getProductSummaries } from "./products";
import { getSessionUser } from "./session-user";

export type { PerfumerOwner, PerfumerTurnEnd };

/** The owner of a message being written: the visitor is always known (`ensureVisitor`). */
export interface PerfumerWriter {
  userId: number | null;
  anonymousId: string;
}

/** Stored messages read for the model's history: enough for 10 once error markers are left out. */
const HISTORY_WINDOW = PERFUMER_MAX_MESSAGES * 3;

const turnOf = (asked: number) => Math.min(Math.max(asked, 1), MAX_PERFUMER_TURN);

/**
 * Whose chat a request reads: the logged-in customer's, else the visitor's (a revoked session
 * counts as a guest, like the cart). Only reads cookies: it never creates a visitor.
 */
export async function getPerfumerOwner(
  request: Request,
  db: Db = defaultDb,
): Promise<PerfumerOwner> {
  const [user, visitor] = await Promise.all([getSessionUser(request, db), readVisitor(request)]);
  return { userId: user?.id ?? null, anonymousId: visitor.anonymousId ?? null };
}

/**
 * Who writes a message: the logged-in customer, and the visitor (created if needed: the id works
 * without analytics consent, like the guest cart's, #18).
 */
export async function getPerfumerWriter(
  args: RequestArgs,
  db: Db = defaultDb,
): Promise<PerfumerWriter> {
  const [user, visitor] = await Promise.all([
    getSessionUser(args.request, db),
    ensureVisitor(args, db),
  ]);
  return { userId: user?.id ?? null, anonymousId: visitor.anonymousId };
}

/** The current products of the saved answers' picks, by `public_id`; archived ones are missing. */
async function pickProducts(
  rows: readonly PerfumerMessageRow[],
  db: Db,
): Promise<Map<string, ProductSummary>> {
  const ids = rows.flatMap((row) =>
    row.reply
      ? (parseStoredPerfumerReply(row.reply)?.picks.map((pick) => pick.productId) ?? [])
      : [],
  );
  return getProductSummaries(ids, db);
}

/** A saved answer as the page and the model see it: its picks with today's product data. */
function toReply(
  row: PerfumerMessageRow,
  products: ReadonlyMap<string, ProductSummary>,
): { reply: PerfumerReply; replyId: string; turn: number; rating?: PerfumerRating } | null {
  const stored = row.reply ? parseStoredPerfumerReply(row.reply) : null;
  if (!stored) {
    if (row.reply) console.warn(`AI perfumer: skipped saved answer ${row.id} of an unknown shape`);
    return null;
  }
  const picks: PerfumerPick[] = stored.picks.flatMap(({ productId, reason }) => {
    const product = products.get(productId);
    return product ? [{ product, reason }] : [];
  });
  return {
    reply: {
      intro: row.text ?? "",
      picks,
      ...(stored.question ? { question: stored.question } : {}),
    },
    replyId: stored.replyId,
    turn: stored.turn,
    ...(stored.rating ? { rating: stored.rating } : {}),
  };
}

/**
 * The conversation sent to the model: the customer's messages and the perfumer's saved answers
 * (as text: intro, the picks' names, the question), without error markers, at most the last
 * `PERFUMER_MAX_MESSAGES`. Only stored messages, never anything the browser sent.
 */
export async function storedHistory(
  rows: readonly PerfumerMessageRow[],
  db: Db = defaultDb,
): Promise<PerfumerMessage[]> {
  const products = await pickProducts(rows, db);
  const messages: PerfumerMessage[] = [];
  for (const row of rows) {
    if (row.role === "user" && row.text) {
      messages.push({ role: "user", content: row.text });
    } else if (row.role === "perfumer") {
      const answer = toReply(row, products);
      const content = answer ? replyToHistoryText(answer.reply) : "";
      if (content) messages.push({ role: "assistant", content });
    }
  }
  return messages.slice(-PERFUMER_MAX_MESSAGES);
}

/**
 * The owner's active chat as the page shows it: the newest 50 messages, saved answers with their
 * products' current data (archived ones left out), or `null` without a chat.
 */
export async function getPerfumerThreadView(
  owner: PerfumerOwner,
  db: Db = defaultDb,
): Promise<PerfumerThreadView | null> {
  const thread = await findActiveThread(db, owner);
  if (!thread) return null;
  const rows = await listRecentMessages(db, thread.id, PERFUMER_MAX_THREAD_ITEMS);
  const products = await pickProducts(rows, db);
  const items: ThreadItem[] = [];
  let lastText = "";
  for (const row of rows) {
    const id = String(row.id);
    if (row.role === "user") {
      lastText = row.text ?? "";
      items.push({ id, role: "user", text: lastText });
    } else if (row.errorKey === "cancelled") {
      items.push({ id, role: "cancelled" });
    } else if (row.errorKey) {
      items.push({ id, role: "error", error: row.errorKey, retryText: lastText });
    } else {
      const answer = toReply(row, products);
      if (answer) items.push({ id, role: "perfumer", ...answer });
    }
  }
  return { entry: thread.entry, items };
}

/** The `turn` a new message of the owner would get (#166), for a refused one's event. */
export async function nextPerfumerTurn(owner: PerfumerOwner, db: Db = defaultDb): Promise<number> {
  const thread = await findActiveThread(db, owner);
  return turnOf((thread ? await countUserMessages(db, thread.id) : 0) + 1);
}

export interface PerfumerTurnStart {
  threadId: number;
  /** The customer's message number in the thread (#166). */
  turn: number;
  /** How the conversation was opened: the request's entry point, else the thread's. */
  entry: PerfumerEntry;
  /** The stored conversation for the model, ending with this message. */
  history: PerfumerMessage[];
}

/**
 * Starts a turn: in one transaction, finds or creates the owner's active thread and appends the
 * customer's message; then reads the history for the model from the database. `retry` (the
 * page's "Try again", or its fallback after a broken stream): when the thread ends with this very
 * message, alone or followed by an error marker, the marker is removed and the stored message is
 * answered again instead of appending a copy.
 */
export async function beginPerfumerTurn(
  {
    owner,
    message,
    entry,
    retry,
  }: { owner: PerfumerWriter; message: string; entry: PerfumerEntry; retry: boolean },
  db: Db = defaultDb,
): Promise<PerfumerTurnStart> {
  const started = await db.transaction(async (tx) => {
    const thread = await lockOrCreateActiveThread(tx, owner, entry);
    let append = true;
    if (retry) {
      const recent = await listRecentMessages(tx, thread.id, 2);
      const last = recent.at(-1);
      const before = recent.at(-2);
      if (last?.role === "user" && last.text === message) {
        // The first try saved the message and never got to its end (a broken stream).
        append = false;
      } else if (last?.errorKey && before?.role === "user" && before.text === message) {
        await deleteMessage(tx, last.id);
        append = false;
      }
    }
    if (append) await insertUserMessage(tx, thread.id, message);
    await touchThread(tx, thread.id);
    return {
      threadId: thread.id,
      turn: turnOf(await countUserMessages(tx, thread.id)),
      entry: entry === "direct" ? thread.entry : entry,
    };
  });
  const rows = await listRecentMessages(db, started.threadId, HISTORY_WINDOW);
  return { ...started, history: await storedHistory(rows, db) };
}

/** Saves the perfumer's side of a turn; nothing when the thread was deleted meanwhile. */
export async function endPerfumerTurn(
  threadId: number,
  end: PerfumerTurnEnd,
  db: Db = defaultDb,
): Promise<void> {
  await saveTurnEnd(db, threadId, end);
}

/** "New chat": closes the active thread; the next message starts another. */
export async function startNewPerfumerChat(owner: PerfumerOwner, db: Db = defaultDb) {
  return closeActiveThread(db, owner);
}

/**
 * "Delete chat": the active thread is never shown again. Its rows stay until the retention job
 * (`pnpm db:prune-perfumer-chats`) erases them, 90 days after this.
 */
export async function deletePerfumerChat(owner: PerfumerOwner, db: Db = defaultDb) {
  return softDeleteActiveThread(db, owner);
}

/** Keeps the customer's rating on their saved answer, so it survives a reload. */
export async function ratePerfumerReply(
  owner: PerfumerOwner,
  replyId: string,
  rating: PerfumerRating,
  db: Db = defaultDb,
): Promise<boolean> {
  return setReplyRating(db, owner, replyId, rating);
}

/**
 * At login (next to `mergeGuestCart`): the guest's active chat becomes the account's; when the
 * account already has one, the more recent stays active and the other is closed.
 */
export async function mergeGuestPerfumerThread(
  userId: number,
  anonymousId: string,
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction((tx) => moveGuestThreadToUser(tx, anonymousId, userId));
}
