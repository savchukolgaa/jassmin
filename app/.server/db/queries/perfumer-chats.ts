// The AI perfumer's saved chats (#180): `perfumer_threads` and `perfumer_messages`. A thread
// belongs to a customer (`user_id`) or, without one, to a visitor (`anonymous_id` with `user_id`
// null), so a logged-out browser never sees the account's chat. A deleted thread (`deleted_at`) is
// invisible to every lookup here but the retention job's.
import { and, desc, eq, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type {
  PerfumerEntry,
  PerfumerRating,
  PerfumerStoredErrorKey,
  StoredPerfumerReply,
} from "~/lib/perfumer";
import type { Db } from "../client";
import { perfumerMessages, perfumerThreads } from "../schema";

type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

/** Whose chat: a customer's (`userId`) or, without one, a visitor's. */
export interface PerfumerOwner {
  userId: number | null;
  anonymousId: string | null;
}

export type PerfumerThreadRow = typeof perfumerThreads.$inferSelect;
export type PerfumerMessageRow = typeof perfumerMessages.$inferSelect;

/** The owner's threads that aren't deleted, or `undefined` when the owner is nobody. */
function ownedBy(owner: PerfumerOwner): SQL | undefined {
  if (owner.userId !== null) {
    return and(eq(perfumerThreads.userId, owner.userId), isNull(perfumerThreads.deletedAt));
  }
  if (owner.anonymousId) {
    return and(
      eq(perfumerThreads.anonymousId, owner.anonymousId),
      isNull(perfumerThreads.userId),
      isNull(perfumerThreads.deletedAt),
    );
  }
  return undefined;
}

/** The owner's active thread. */
function activeOf(owner: PerfumerOwner): SQL | undefined {
  const owned = ownedBy(owner);
  return owned && and(owned, isNull(perfumerThreads.closedAt));
}

/** The owner's active thread, or `undefined` without one. */
export async function findActiveThread(
  db: Executor,
  owner: PerfumerOwner,
): Promise<PerfumerThreadRow | undefined> {
  const where = activeOf(owner);
  if (!where) return undefined;
  const [row] = await db.select().from(perfumerThreads).where(where).limit(1);
  return row;
}

async function lockActiveThread(tx: Executor, where: SQL): Promise<PerfumerThreadRow | undefined> {
  const [row] = await tx.select().from(perfumerThreads).where(where).limit(1).for("update");
  return row;
}

/**
 * The owner's active thread, locked for this transaction; created (with `entry`) when there's
 * none. Two first messages at once can't create two: the partial unique indexes refuse the
 * second insert, which then locks the first one's row.
 */
export async function lockOrCreateActiveThread(
  tx: Executor,
  owner: { userId: number | null; anonymousId: string },
  entry: PerfumerEntry,
): Promise<PerfumerThreadRow> {
  const where = activeOf(owner);
  if (!where) throw new Error("A perfumer thread needs an owner");
  const existing = await lockActiveThread(tx, where);
  if (existing) return existing;
  const [created] = await tx
    .insert(perfumerThreads)
    .values({ anonymousId: owner.anonymousId, userId: owner.userId, entry })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const raced = await lockActiveThread(tx, where);
  if (!raced) throw new Error("The perfumer thread vanished while it was created");
  return raced;
}

/** The thread's newest `limit` messages, oldest first. */
export async function listRecentMessages(
  db: Executor,
  threadId: number,
  limit: number,
): Promise<PerfumerMessageRow[]> {
  const rows = await db
    .select()
    .from(perfumerMessages)
    .where(eq(perfumerMessages.threadId, threadId))
    .orderBy(desc(perfumerMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** How many messages the customer wrote in the thread. */
export async function countUserMessages(db: Executor, threadId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(perfumerMessages)
    .where(and(eq(perfumerMessages.threadId, threadId), eq(perfumerMessages.role, "user")));
  return row?.count ?? 0;
}

export async function insertUserMessage(
  tx: Executor,
  threadId: number,
  text: string,
): Promise<void> {
  await tx.insert(perfumerMessages).values({ threadId, role: "user", text });
}

export async function deleteMessage(tx: Executor, id: number): Promise<void> {
  await tx.delete(perfumerMessages).where(eq(perfumerMessages.id, id));
}

/** Moves the thread's `updated_at` (the retention job counts from it) to now. */
export async function touchThread(tx: Executor, threadId: number): Promise<void> {
  await tx
    .update(perfumerThreads)
    .set({ updatedAt: new Date() })
    .where(eq(perfumerThreads.id, threadId));
}

/** The perfumer's side of a turn: a saved answer (intro + reply) or an error marker. */
export type PerfumerTurnEnd =
  | { intro: string; reply: StoredPerfumerReply }
  | { errorKey: PerfumerStoredErrorKey };

/**
 * Saves the end of a turn and touches the thread, unless the thread was deleted meanwhile (by
 * the customer or the retention job): then nothing is written. Returns whether it was saved.
 */
export async function saveTurnEnd(
  db: Db,
  threadId: number,
  end: PerfumerTurnEnd,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [thread] = await tx
      .select({ id: perfumerThreads.id })
      .from(perfumerThreads)
      .where(and(eq(perfumerThreads.id, threadId), isNull(perfumerThreads.deletedAt)))
      .for("update");
    if (!thread) return false;
    await tx
      .insert(perfumerMessages)
      .values(
        "errorKey" in end
          ? { threadId, role: "perfumer", errorKey: end.errorKey }
          : { threadId, role: "perfumer", text: end.intro, reply: end.reply },
      );
    await touchThread(tx, threadId);
    return true;
  });
}

/** Notes the customer's rating on their saved answer `replyId`; returns whether one matched. */
export async function setReplyRating(
  db: Executor,
  owner: PerfumerOwner,
  replyId: string,
  rating: PerfumerRating,
): Promise<boolean> {
  const owned = ownedBy(owner);
  if (!owned) return false;
  const threads = db.select({ id: perfumerThreads.id }).from(perfumerThreads).where(owned);
  const rows = await db
    .update(perfumerMessages)
    .set({ reply: sql`${perfumerMessages.reply} || jsonb_build_object('rating', ${rating}::text)` })
    .where(
      and(
        inArray(perfumerMessages.threadId, threads),
        sql`${perfumerMessages.reply}->>'replyId' = ${replyId}`,
      ),
    )
    .returning({ id: perfumerMessages.id });
  return rows.length > 0;
}

/** Closes the owner's active thread ("New chat"); returns whether there was one. */
export async function closeActiveThread(db: Executor, owner: PerfumerOwner): Promise<boolean> {
  const where = activeOf(owner);
  if (!where) return false;
  const rows = await db
    .update(perfumerThreads)
    .set({ closedAt: new Date() })
    .where(where)
    .returning({ id: perfumerThreads.id });
  return rows.length > 0;
}

/**
 * "Delete chat": closes the owner's active thread and marks it deleted. Its messages stay until
 * the retention job, but no lookup returns it again. Returns whether there was one.
 */
export async function softDeleteActiveThread(db: Executor, owner: PerfumerOwner): Promise<boolean> {
  const where = activeOf(owner);
  if (!where) return false;
  const now = new Date();
  const rows = await db
    .update(perfumerThreads)
    .set({ closedAt: now, deletedAt: now })
    .where(where)
    .returning({ id: perfumerThreads.id });
  return rows.length > 0;
}

/**
 * At login: the guest's active thread becomes the customer's. When the customer already has one,
 * the more recently updated thread stays active and the other is closed. Run in a transaction.
 */
export async function moveGuestThreadToUser(
  tx: Executor,
  anonymousId: string,
  userId: number,
): Promise<void> {
  const guestWhere = activeOf({ userId: null, anonymousId });
  const userWhere = activeOf({ userId, anonymousId: null });
  if (!guestWhere || !userWhere) return;
  const guest = await lockActiveThread(tx, guestWhere);
  if (!guest) return;
  const own = await lockActiveThread(tx, userWhere);
  if (own && own.updatedAt >= guest.updatedAt) {
    await tx
      .update(perfumerThreads)
      .set({ closedAt: new Date() })
      .where(eq(perfumerThreads.id, guest.id));
    return;
  }
  if (own) {
    await tx
      .update(perfumerThreads)
      .set({ closedAt: new Date() })
      .where(eq(perfumerThreads.id, own.id));
  }
  // Keeps `updated_at`: adopting a thread isn't activity in it.
  await tx
    .update(perfumerThreads)
    .set({ userId, updatedAt: guest.updatedAt })
    .where(eq(perfumerThreads.id, guest.id));
}

/** The retention job: deletes threads (with their messages) not updated since `cutoff`. */
export async function deleteThreadsUpdatedBefore(db: Executor, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(perfumerThreads)
    .where(lt(perfumerThreads.updatedAt, cutoff))
    .returning({ id: perfumerThreads.id });
  return rows.length;
}
