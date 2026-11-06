// Input of the unsubscribe page (#139). Imported only by its route and tests, so zod stays out of
// the browser bundle (#96).
import { z } from "zod";

/** The token in the link: a user id and a base64url HMAC (`unsubscribe-token.ts`). */
export const unsubscribeTokenSchema = z.string().regex(/^[1-9]\d{0,9}\.[A-Za-z0-9_-]{43}$/);

/**
 * The POST body: empty from the page's own button, or `List-Unsubscribe=One-Click` from a mail
 * client (RFC 8058). Both unsubscribe; anything else in the field is refused.
 */
export const unsubscribeFormSchema = z.object({
  "List-Unsubscribe": z.literal("One-Click").optional(),
});
