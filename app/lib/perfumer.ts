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
