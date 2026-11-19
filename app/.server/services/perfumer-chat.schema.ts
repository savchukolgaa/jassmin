// The saved answer of an AI perfumer chat (#180), `perfumer_messages.reply`: checked before it's
// written and again when it's read, so a row from an older shape (or edited by hand) is skipped
// instead of breaking the chat page.
import { z } from "zod";
import { MAX_PERFUMER_TURN, PERFUMER_RATINGS, type StoredPerfumerReply } from "~/lib/perfumer";

/** The longest saved reason or question; the engine's own fields are shorter. */
const MAX_STORED_TEXT = 2000;

export const storedPerfumerReplySchema = z.object({
  picks: z.array(z.object({ productId: z.uuid(), reason: z.string().max(MAX_STORED_TEXT) })).max(4),
  question: z.string().min(1).max(MAX_STORED_TEXT).optional(),
  replyId: z.uuid(),
  turn: z.int().min(1).max(MAX_PERFUMER_TURN),
  rating: z.enum(PERFUMER_RATINGS).optional(),
}) satisfies z.ZodType<StoredPerfumerReply>;

/** The saved answer, or `null` when `value` isn't one. */
export function parseStoredPerfumerReply(value: unknown): StoredPerfumerReply | null {
  const parsed = storedPerfumerReplySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
