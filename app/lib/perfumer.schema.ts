// The AI perfumer chat's request (#163), validated by its route's `action`. Imported only by route
// actions, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { msg } from "./i18n";
import {
  PERFUMER_MAX_INPUT_LENGTH,
  PERFUMER_MAX_MESSAGES,
  type PerfumerErrorKey,
  type PerfumerMessage,
} from "./perfumer";

const TOO_LONG = msg("perfumer.errors.tooLong");

/** `{ messages }`: 1–10 messages of 1–500 characters, the last one the customer's. */
export const perfumerRequestSchema = z.object({
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
  | { ok: true; messages: PerfumerMessage[] }
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
    return { ok: true, messages: parsed.data.messages };
  }
  const tooLong = parsed.error.issues.some((issue) => issue.message === TOO_LONG);
  return { ok: false, error: tooLong ? "tooLong" : "unavailable" };
}
