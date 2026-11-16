// The AI perfumer's conversation and reply (#162), shared by the engine and the chat page (#163).
// Isomorphic: no server imports and no zod (`app/.server/ai/perfumer.schema.ts` validates input).
import type { ProductSummary } from "./products";

/** At most this many messages are sent per reply; the conversation isn't stored. */
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
  | { type: "done" };

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
      return true;
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

/** The chat action's result: locale-independent, so it can be rendered in either language. */
export type PerfumerActionResult =
  | { ok: true; reply: PerfumerReply }
  | { ok: false; error: PerfumerErrorKey };

/** Errors worth retrying as they are; for the others, waiting or editing the message is the fix. */
export function isRetryable(error: PerfumerErrorKey): boolean {
  return error === "unavailable" || error === "timeout";
}

/** One entry of the chat thread the browser shows and keeps in `sessionStorage`. */
export type ThreadItem =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "perfumer"; reply: PerfumerReply }
  | { id: string; role: "error"; error: PerfumerErrorKey; retryText: string }
  | { id: string; role: "cancelled" };

/**
 * A perfumer reply as the text of an assistant turn in the history: the intro, the picks' names
 * and the question, cut to `PERFUMER_MAX_INPUT_LENGTH`. The names come from the server's own
 * reply, so the model learns nothing new; they let a follow-up ("а щось схоже на другий?") work.
 */
export function replyToHistoryText(reply: PerfumerReply): string {
  const lines = [
    reply.intro,
    ...reply.picks.map((pick) => `- ${pick.product.title} (${pick.product.brand})`),
    reply.question ?? "",
  ].filter((line) => line.trim() !== "");
  return lines.join("\n").slice(0, PERFUMER_MAX_INPUT_LENGTH).trim();
}

/**
 * The conversation sent with a message: the customer's messages and the perfumer's replies, without
 * errors and cancelled turns, at most the last `PERFUMER_MAX_MESSAGES`.
 */
export function toHistory(items: readonly ThreadItem[]): PerfumerMessage[] {
  const messages: PerfumerMessage[] = [];
  for (const item of items) {
    if (item.role === "user") {
      messages.push({ role: "user", content: item.text });
    } else if (item.role === "perfumer") {
      const content = replyToHistoryText(item.reply);
      if (content) messages.push({ role: "assistant", content });
    }
  }
  return messages.slice(-PERFUMER_MAX_MESSAGES);
}
