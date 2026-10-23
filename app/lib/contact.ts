// Shared types and limits for the home page contact form (route action ↔ form UI).
import type { TextKey } from "./i18n";

export const CONTACT_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 2000,
} as const;

/** Hidden field that people never fill in; bots that do are silently ignored. */
export const HONEYPOT_FIELD = "website";

export type ContactField = "name" | "email" | "message";

export type ContactValues = Record<ContactField, string>;

/** The first error per invalid field, as a message key (translated with `CONTACT_LIMITS`). */
export type ContactFieldErrors = Partial<Record<ContactField, TextKey>>;

export type ContactActionResult =
  | { status: "success" }
  | { status: "invalid"; fieldErrors: ContactFieldErrors; values: ContactValues }
  | { status: "rate_limited"; retryAfterSeconds: number; values: ContactValues }
  | { status: "delivery_failed"; values: ContactValues };
