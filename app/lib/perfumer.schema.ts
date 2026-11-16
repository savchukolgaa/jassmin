// The AI perfumer chat's request (#163), validated by its route's `action`. Imported only by route
// actions, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { msg } from "./i18n";
import {
  MAX_PERFUMER_TURN,
  PERFUMER_ENTRIES,
  PERFUMER_MAX_INPUT_LENGTH,
  PERFUMER_MAX_MESSAGES,
  PERFUMER_PREFILL_PARAM,
  PERFUMER_RATINGS,
  type PerfumerEntry,
  type PerfumerErrorKey,
  type PerfumerMessage,
  type PerfumerRating,
} from "./perfumer";

const TOO_LONG = msg("perfumer.errors.tooLong");

const turnSchema = z.int().min(1).max(MAX_PERFUMER_TURN);

/**
 * `{ messages, turn, entry }`: 1–10 messages of 1–500 characters, the last one the customer's;
 * the customer's message number in the thread and how the chat was opened (#166). A page opened
 * before #166 sends neither: `turn` is then counted from the messages and `entry` is `direct`.
 */
export const perfumerRequestSchema = z.object({
  turn: turnSchema.optional(),
  entry: z.enum(PERFUMER_ENTRIES).catch("direct").default("direct"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(PERFUMER_MAX_INPUT_LENGTH, TOO_LONG),
      }),
    )
    .min(1)
    .max(PERFUMER_MAX_MESSAGES)
    .refine((messages) => messages.at(-1)?.role === "user"),
});

export type PerfumerRequestResult =
  | { ok: true; messages: PerfumerMessage[]; turn: number; entry: PerfumerEntry }
  | { ok: false; error: PerfumerErrorKey };

/**
 * Parses the chat form's `payload` field (JSON). A message over 500 characters is `tooLong`; any
 * other bad shape can only come from a tampered request and is `unavailable`.
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
    const { messages, turn, entry } = parsed.data;
    const asked = messages.filter((message) => message.role === "user").length;
    return { ok: true, messages, turn: turn ?? asked, entry };
  }
  const tooLong = parsed.error.issues.some((issue) => issue.message === TOO_LONG);
  return { ok: false, error: tooLong ? "tooLong" : "unavailable" };
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
