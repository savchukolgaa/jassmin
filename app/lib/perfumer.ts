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
