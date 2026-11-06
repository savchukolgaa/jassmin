// Analytics cookie consent (#18): the cookie banner's choice and the form that posts it to
// `routes/consent.ts`. Isomorphic: no server imports.
import type { TextKey } from "./i18n";

/** Name of the cookie that stores the visitor's choice for 1 year. */
export const CONSENT_COOKIE = "cookie_consent";

/** `granted` turns analytics tracking on; `denied` keeps only strictly necessary cookies. */
export const CONSENT_VALUES = ["granted", "denied"] as const;

export type ConsentValue = (typeof CONSENT_VALUES)[number];

export function isConsentValue(value: unknown): value is ConsentValue {
  return CONSENT_VALUES.some((consent) => consent === value);
}

export type { ConsentFormInput } from "./consent.schema";

/** When the privacy policy last changed (ISO date), shown on the page. */
export const PRIVACY_POLICY_UPDATED_AT = "2026-11-06";

/** A cookie the site sets, as the privacy policy lists it. Copy are message keys. */
export interface CookieInfo {
  name: string;
  purposeKey: TextKey;
  lifetimeKey: TextKey;
}

/**
 * Every cookie the site sets. `consent.test.ts` checks it against the cookie names in the code,
 * so the privacy policy can't fall behind.
 */
export const COOKIE_INVENTORY = [
  {
    name: "__jassmin_session",
    purposeKey: "privacy.cookies.session",
    lifetimeKey: "privacy.cookies.days30",
  },
  { name: "locale", purposeKey: "privacy.cookies.locale", lifetimeKey: "privacy.cookies.year" },
  {
    name: CONSENT_COOKIE,
    purposeKey: "privacy.cookies.consent",
    lifetimeKey: "privacy.cookies.year",
  },
  {
    name: "anonymous_id",
    purposeKey: "privacy.cookies.anonymousId",
    lifetimeKey: "privacy.cookies.year",
  },
  {
    name: "analytics_session",
    purposeKey: "privacy.cookies.analyticsSession",
    lifetimeKey: "privacy.cookies.browserSession",
  },
] as const satisfies readonly CookieInfo[];
