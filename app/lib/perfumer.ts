// The AI perfumer's conversation and reply (#162), shared by the engine and the chat page (#163).
// Isomorphic: no server imports and no zod (`app/.server/ai/perfumer.schema.ts` validates input).
import type { Page } from "./paths";
import type { ProductSummary } from "./products";

/** At most this many stored messages are sent to the model per reply (#180). */
export const PERFUMER_MAX_MESSAGES = 10;

/** The longest message a customer may send. */
export const PERFUMER_MAX_MESSAGE_LENGTH = 1000;

export interface PerfumerMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PerfumerPick {
  /** Loaded from the database: the name, brand and prices never come from the model. */
  product: ProductSummary;
  reason: string;
}

export interface PerfumerReply {
  intro: string;
  /** 0–4 active products in stock, in the order the model recommends them. */
  picks: PerfumerPick[];
  /** One clarifying question, when the model asks one. */
  question?: string;
}

// Streaming (#164): the events of `POST /parfumer/stream`, in this order: `step`* → `intro`* →
// `picks` → `question`? → `done`, or one `error` at any point (then the stream ends).

/**
 * One catalog tool call, as the chat shows it ("Шукаю в каталозі: цитрусові, до 600 ₴"). Only
 * resolved, catalog-safe values: the families after the synonym mapping and a catalog title, never
 * the model's own note words or a title the shop doesn't have.
 */
export type PerfumerStep =
  | {
      tool: "search";
      gender?: "women" | "men";
      /** Stored Ukrainian family values; label them with `fragranceFamilyLabel`. */
      families: string[];
      maxPriceUah?: number;
      /** How many perfumes the search returned. */
      found: number;
    }
  | {
      tool: "similar";
      /** The catalog title, when found. */
      title?: string;
      found: number;
    };

export type PerfumerEvent =
  | { type: "step"; step: PerfumerStep }
  /** One or more whole, checked sentences of the intro, to append as they are. */
  | { type: "intro"; text: string }
  | { type: "picks"; picks: PerfumerPick[] }
  | { type: "question"; text: string }
  | { type: "error"; error: PerfumerErrorKey }
  /** The end of a reply; `replyId` names it in analytics (#166), so its rating can be joined. */
  | { type: "done"; replyId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStep(value: unknown): value is PerfumerStep {
  if (!isRecord(value) || typeof value.found !== "number") return false;
  if (value.tool === "similar") {
    return value.title === undefined || typeof value.title === "string";
  }
  return (
    value.tool === "search" &&
    Array.isArray(value.families) &&
    value.families.every((family) => typeof family === "string") &&
    (value.gender === undefined || value.gender === "women" || value.gender === "men") &&
    (value.maxPriceUah === undefined || typeof value.maxPriceUah === "number")
  );
}

function isPick(value: unknown): value is PerfumerPick {
  return (
    isRecord(value) &&
    typeof value.reason === "string" &&
    isRecord(value.product) &&
    typeof value.product.id === "string" &&
    typeof value.product.title === "string" &&
    Array.isArray(value.product.variants)
  );
}

/**
 * Whether a parsed stream event has the expected shape. A plain guard rather than zod, which stays
 * out of the browser bundle (#96); the products are the server's own data, so only their shape
 * is checked.
 */
export function isPerfumerEvent(value: unknown): value is PerfumerEvent {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "step":
      return isStep(value.step);
    case "intro":
    case "question":
      return typeof value.text === "string";
    case "picks":
      return Array.isArray(value.picks) && value.picks.every(isPick);
    case "error":
      return (
        typeof value.error === "string" &&
        (PERFUMER_ERROR_KEYS as readonly string[]).includes(value.error)
      );
    case "done":
      return value.replyId === undefined || typeof value.replyId === "string";
    default:
      return false;
  }
}

// The chat page (#163): what the browser keeps and sends, and what the action returns.

/** The longest message a customer may type in the chat (the engine itself allows more). */
export const PERFUMER_MAX_INPUT_LENGTH = 500;

/** The chat's character counter appears from this length. */
export const PERFUMER_COUNTER_FROM = 400;

/** Why the chat couldn't answer; each is `perfumer.errors.<key>` in the dictionaries. */
export const PERFUMER_ERROR_KEYS = ["unavailable", "timeout", "rateLimited", "tooLong"] as const;

export type PerfumerErrorKey = (typeof PERFUMER_ERROR_KEYS)[number];

// Saved chats (#180): the thread lives in PostgreSQL (`perfumer_threads`, `perfumer_messages`).

/** Who wrote a stored message: the customer, or the perfumer (a reply or an error marker). */
export const PERFUMER_MESSAGE_ROLES = ["user", "perfumer"] as const;

export type PerfumerMessageRole = (typeof PERFUMER_MESSAGE_ROLES)[number];

/** Why a stored turn has no reply: a chat error, or the customer cancelled it. */
export const PERFUMER_STORED_ERROR_KEYS = [...PERFUMER_ERROR_KEYS, "cancelled"] as const;

export type PerfumerStoredErrorKey = (typeof PERFUMER_STORED_ERROR_KEYS)[number];

/**
 * A saved answer (`perfumer_messages.reply`): the picks as product ids with reasons, never product
 * data, so a reloaded answer shows current prices and leaves out archived products. The intro is
 * the row's `text`. `replyId` names it in analytics (#166) and `rating` is the customer's.
 */
export interface StoredPerfumerReply {
  /** `products.public_id` of each pick, in the model's order. */
  picks: { productId: string; reason: string }[];
  question?: string;
  replyId: string;
  /** The customer's message number this answers. */
  turn: number;
  rating?: PerfumerRating;
}

/** A saved chat as the page starts from it. */
export interface PerfumerThreadView {
  /** How the conversation was opened (#166). */
  entry: PerfumerEntry;
  items: ThreadItem[];
}

/** The chat page's buttons: close the chat ("New chat") or delete it for the customer. */
export const PERFUMER_CHAT_INTENTS = ["new-chat", "delete-chat"] as const;

export type PerfumerChatIntent = (typeof PERFUMER_CHAT_INTENTS)[number];

/** The chat page shows at most this many of the newest stored messages. */
export const PERFUMER_MAX_THREAD_ITEMS = 50;

/**
 * The chat action's result: locale-independent, so it can be rendered in either language.
 * `replyId` names the answer in analytics (#166), so its rating can be joined to it.
 */
export type PerfumerActionResult =
  | { ok: true; reply: PerfumerReply; replyId: string }
  | { ok: false; error: PerfumerErrorKey };

/** Errors worth retrying as they are; for the others, waiting or editing the message is the fix. */
export function isRetryable(error: PerfumerErrorKey): boolean {
  return error === "unavailable" || error === "timeout";
}

// Analytics (#166): what `perfumer_message` and `perfumer_feedback` events record. Never text.

/** How the customer opened the conversation: the chat page's `?from=`, else `direct`. */
export const PERFUMER_ENTRIES = [
  "menu",
  "catalog",
  "empty_results",
  "product",
  "corner",
  "direct",
] as const;

export type PerfumerEntry = (typeof PERFUMER_ENTRIES)[number];

/** `entry` from the `from` query parameter: anything unknown (or none) is `direct`. */
export function toPerfumerEntry(value: string | null | undefined): PerfumerEntry {
  return PERFUMER_ENTRIES.find((entry) => entry === value) ?? "direct";
}

/** Why an answer failed, for the owner: finer than the chat's `PerfumerErrorKey`. */
export const PERFUMER_TELEMETRY_ERRORS = [
  "unavailable",
  "timeout",
  "bad_response",
  "rate_limited",
  "cancelled",
] as const;

export type PerfumerTelemetryError = (typeof PERFUMER_TELEMETRY_ERRORS)[number];

/** The engine's tools; any other name the model calls is recorded as `other`. */
export const PERFUMER_TOOL_NAMES = ["search_perfumes", "similar_to", "other"] as const;

export type PerfumerToolName = (typeof PERFUMER_TOOL_NAMES)[number];

/** The highest `turn` recorded: the customer's message number in one thread. */
export const MAX_PERFUMER_TURN = 100;

export const PERFUMER_RATINGS = ["up", "down"] as const;

export type PerfumerRating = (typeof PERFUMER_RATINGS)[number];

/** One entry of the chat thread the page shows; the saved thread is the server's (#180). */
export type ThreadItem =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "perfumer";
      reply: PerfumerReply;
      /** Names the answer in analytics (#166); answers kept from before #166 have none. */
      replyId?: string;
      /** The customer's message number this answers. */
      turn?: number;
      /** The customer's rating of the answer, once given. */
      rating?: PerfumerRating;
    }
  | { id: string; role: "error"; error: PerfumerErrorKey; retryText: string }
  | { id: string; role: "cancelled" };

/**
 * A perfumer reply as the text of an assistant turn in the history: the intro, the picks' names
 * and the question, cut to `PERFUMER_MAX_INPUT_LENGTH`. The names come from the server's own
 * reply, so the model learns nothing new; they let a follow-up ("а щось схоже на другий?") work.
 * The server builds the history from the saved thread with it (#180).
 */
export function replyToHistoryText(reply: PerfumerReply): string {
  const lines = [
    reply.intro,
    ...reply.picks.map((pick) => `- ${pick.product.title} (${pick.product.brand})`),
    reply.question ?? "",
  ].filter((line) => line.trim() !== "");
  return lines.join("\n").slice(0, PERFUMER_MAX_INPUT_LENGTH).trim();
}

// Entry points to the chat (#165): the corner button, the catalog banner and the product link.

/** The chat page's query parameter with a message to send once on arrival (`/parfumer?q=…`). */
export const PERFUMER_PREFILL_PARAM = "q";

/**
 * Pages without the floating corner button: the chat itself, and the cart, checkout and payment
 * pages, where it would distract from paying.
 */
export const PERFUMER_CORNER_HIDDEN_PAGES: ReadonlySet<Page> = new Set<Page>([
  "perfumer",
  "cart",
  "checkout",
  "checkoutSuccess",
  "checkoutPay",
  "giftCardSuccess",
]);

/** Whether the corner button shows on `page` (`null`: a URL outside the path table). */
export function showPerfumerCorner(page: Page | null): boolean {
  return page === null || !PERFUMER_CORNER_HIDDEN_PAGES.has(page);
}

/** The query parameter that says how the chat was opened, for analytics (#166). */
export const PERFUMER_ENTRY_PARAM = "from";

/**
 * The chat page's search params that send `message` once the page opens, and say which entry
 * point opened it (#166).
 */
export function perfumerPrefillSearch(message: string, entry?: PerfumerEntry): URLSearchParams {
  const search = new URLSearchParams({ [PERFUMER_PREFILL_PARAM]: message.trim() });
  if (entry) search.set(PERFUMER_ENTRY_PARAM, entry);
  return search;
}
