// The body Brevo posts to `/hooks/email` (#134): one transactional email event, or an array of
// them when batching is on. Only the fields we use are kept; the rest is dropped.
// https://developers.brevo.com/docs/transactional-webhooks
import { z } from "zod";

/** RFC 5322 caps a header line at 998 characters; nothing we keep is longer. */
const header = z.string().max(998);

export const brevoEventSchema = z.object({
  /** `hard_bounce`, `spam`, `blocked`, `invalid_email`, `soft_bounce`, `delivered`, … */
  event: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((event) => event.toLowerCase()),
  /** The recipient. Not `z.email()`: an invalid address is exactly what `invalid_email` reports. */
  email: z.string().trim().min(3).max(320).includes("@"),
  "message-id": header.optional(),
  /** Our `X-Mailin-custom` header, echoed back (`order-email:<id>`). */
  "X-Mailin-custom": header.optional(),
  /** Why it bounced or was blocked, in Brevo's or the receiving server's words. */
  reason: z.string().max(2000).optional(),
});

export type BrevoEvent = z.infer<typeof brevoEventSchema>;

export const brevoWebhookSchema = z.union([
  brevoEventSchema.transform((event) => [event]),
  z.array(brevoEventSchema).min(1).max(1000),
]);
