// The AI perfumer chat's request (#163), validated by its route's `action`. Imported only by route
// actions, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { msg } from "./i18n";
import {
  MAX_PERFUMER_TURN,
  PERFUMER_CHAT_INTENTS,
  PERFUMER_ENTRIES,
  PERFUMER_MAX_INPUT_LENGTH,
  PERFUMER_PREFILL_PARAM,
  PERFUMER_RATINGS,
  type PerfumerChatIntent,
  type PerfumerEntry,
  type PerfumerErrorKey,
  type PerfumerRating,
} from "./perfumer";

const TOO_LONG = msg("perfumer.errors.tooLong");

const turnSchema = z.int().min(1).max(MAX_PERFUMER_TURN);

/**
 * `{ message, entry, retry? }` (#180): the customer's new message (1–500 characters), how the
 * chat was opened (#166) and whether it retries the thread's last message after an error. The
 * conversation is the server's own (`perfumer_messages`): a payload with any other key, such as
 * an earlier page's `messages` history or `turn`, is refused.
 */
export const perfumerRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(PERFUMER_MAX_INPUT_LENGTH, TOO_LONG),
  entry: z.enum(PERFUMER_ENTRIES).catch("direct").default("direct"),
  retry: z.literal(true).optional(),
});

export type PerfumerRequestResult =
  | { ok: true; message: string; entry: PerfumerEntry; retry: boolean }
  | { ok: false; error: PerfumerErrorKey };

/**
 * Parses the chat form's `payload` field (JSON). A message over 500 characters is `tooLong`; any
 * other bad shape can only come from a tampered request (or a page from before #180) and is
 * `unavailable`.
 */
export function parsePerfumerRequest(formData: FormData): PerfumerRequestResult {
  const payload = formData.get("payload");
  let json: unknown;
  try {
    json = typeof payload === "string" ? JSON.parse(payload) : undefined;
  } catch {
    return { ok: false, error: "unavailable" };
  }
  const parsed = perfumerRequestSchema.safeParse(json);
  if (parsed.success) {
    const { message, entry, retry } = parsed.data;
    return { ok: true, message, entry, retry: retry ?? false };
  }
  const tooLong = parsed.error.issues.some((issue) => issue.message === TOO_LONG);
  return { ok: false, error: tooLong ? "tooLong" : "unavailable" };
}

/** The chat's other intents (#180): close the chat, or delete it for the customer. */
export const perfumerChatIntentSchema = z.object({ intent: z.enum(PERFUMER_CHAT_INTENTS) });

/** `new-chat` or `delete-chat`, or `null` for any other form. */
export function parsePerfumerChatIntent(formData: FormData): PerfumerChatIntent | null {
  const parsed = perfumerChatIntentSchema.safeParse({ intent: formData.get("intent") });
  return parsed.success ? parsed.data.intent : null;
}

/** The chat page's rating of one answer (#166): `intent=feedback`, `replyId`, `turn`, `rating`. */
export const perfumerFeedbackSchema = z.object({
  intent: z.literal("feedback"),
  replyId: z.uuid(),
  turn: z.coerce.number().pipe(turnSchema),
  rating: z.enum(PERFUMER_RATINGS),
});

export type PerfumerFeedbackResult =
  | { ok: true; replyId: string; turn: number; rating: PerfumerRating }
  | { ok: false };

/** Parses the rating form. A bad one can only come from a tampered request. */
export function parsePerfumerFeedback(formData: FormData): PerfumerFeedbackResult {
  const parsed = perfumerFeedbackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false };
  }
  const { replyId, turn, rating } = parsed.data;
  return { ok: true, replyId, turn, rating };
}

/** A prefilled message (#165): like a typed one, 1–500 characters after trimming. */
const prefillSchema = z
  .string()
  .trim()
  .min(1)
  .max(PERFUMER_MAX_INPUT_LENGTH)
  .nullable()
  .catch(null);

/**
 * The message an entry point asks the chat page to send (`?q=`, #165), or `null`. An empty or too
 * long one (only a hand-edited URL) is dropped quietly rather than shown as an error.
 */
export function parsePerfumerPrefill(params: URLSearchParams): string | null {
  return prefillSchema.parse(params.get(PERFUMER_PREFILL_PARAM));
}
