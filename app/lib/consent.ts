// Analytics cookie consent (#18): the cookie banner's choice and the form that posts it to
// `routes/consent.ts`. Isomorphic: no server imports.
import { z } from "zod";

/** Name of the cookie that stores the visitor's choice for 1 year. */
export const CONSENT_COOKIE = "cookie_consent";

/** `granted` turns analytics tracking on; `denied` keeps only strictly necessary cookies. */
export const CONSENT_VALUES = ["granted", "denied"] as const;

export type ConsentValue = (typeof CONSENT_VALUES)[number];

export function isConsentValue(value: unknown): value is ConsentValue {
  return CONSENT_VALUES.some((consent) => consent === value);
}

/** Posted by the banner (`granted` / `denied`) and the footer's "Cookie settings" (`reset`). */
export const consentFormSchema = z.object({
  consent: z.enum([...CONSENT_VALUES, "reset"]),
  redirectTo: z.string().optional(),
  // The page's `document.referrer`, so a visit that starts with "Accept" keeps its source.
  // Analytics only: an unusable value is dropped.
  referrer: z.string().max(2048).optional().catch(undefined),
});

export type ConsentFormInput = z.infer<typeof consentFormSchema>;

/** The privacy and cookie policy page, linked from the banner, the footer and registration. */
export const PRIVACY_POLICY_PATH = "/privacy";
