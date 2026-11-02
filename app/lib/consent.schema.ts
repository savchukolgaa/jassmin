// The cookie banner's form as a zod schema (#18). Imported only by route loaders/actions, server code and tests, so zod stays out of the client
// bundle (#96).
import { z } from "zod";
import { CONSENT_VALUES } from "./consent";

/** Posted by the banner (`granted` / `denied`) and the footer's "Cookie settings" (`reset`). */
export const consentFormSchema = z.object({
  consent: z.enum([...CONSENT_VALUES, "reset"]),
  redirectTo: z.string().optional(),
  // The page's `document.referrer`, so a visit that starts with "Accept" keeps its source.
  // Analytics only: an unusable value is dropped.
  referrer: z.string().max(2048).optional().catch(undefined),
});

export type ConsentFormInput = z.infer<typeof consentFormSchema>;
