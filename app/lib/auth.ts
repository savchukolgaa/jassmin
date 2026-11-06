// Validation and helpers shared by the login/register routes and their forms. Isomorphic: no
// server imports. Error messages are message keys, translated when the form renders them.
import type { TextKey } from "./i18n";
import { localeFromPath, pathFor } from "./paths";

export type {
  ChangeEmailInput,
  ChangePasswordInput,
  ContactInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schema";

// The forms of the account profile page (#54), told apart by a hidden `intent` field; `marketing`
// gives or withdraws the marketing emails consent (#128).
export const PROFILE_INTENTS = ["contact", "email", "password", "marketing"] as const;
export type ProfileIntent = (typeof PROFILE_INTENTS)[number];

/** How long a password reset link works (#135). */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/** How long an email verification link works (#135): a week, and the account page can resend. */
export const EMAIL_VERIFICATION_TTL_HOURS = 7 * 24;

/** Why an emailed link (#135) can't be used: never issued (or mistyped), already used, or too old. */
export const AUTH_TOKEN_ERRORS = ["unknown", "used", "expired"] as const;
export type AuthTokenError = (typeof AUTH_TOKEN_ERRORS)[number];

/** `marketingOptIn` (#128) is a checkbox: refilled as `on` or blank, never an error. */
export type RegisterField = "fullName" | "email" | "password" | "phone" | "marketingOptIn";
export type LoginField = "email" | "password";
export type ForgotPasswordField = "email";
export type ResetPasswordField = "password" | "confirmPassword";
export type ContactField = "fullName" | "phone";
export type MarketingField = "marketingOptIn";
export type ChangeEmailField = "email" | "currentPassword";
export type ChangePasswordField = "currentPassword" | "newPassword" | "confirmNewPassword";

export interface ProfileFields {
  contact: ContactField;
  email: ChangeEmailField;
  password: ChangePasswordField;
  marketing: MarketingField;
}

/** What the profile page's `action` returns, for the form named by `intent`. */
export type ProfileActionData =
  | { ok: true; intent: ProfileIntent }
  | {
      [Intent in ProfileIntent]: { ok: false; intent: Intent } & AuthFormErrors<
        ProfileFields[Intent]
      >;
    }[ProfileIntent]
  /** The posted `intent` wasn't one of ours. */
  | { ok: false; intent: null; formError: TextKey };

/** What a login/register `action` returns when the form can't be accepted. Errors are keys. */
export interface AuthFormErrors<Field extends string> {
  fieldErrors?: Partial<Record<Field, TextKey>>;
  /** An error about the whole form, e.g. wrong credentials. */
  formError?: TextKey;
  /** Submitted values to refill the form with. Never includes passwords. */
  values?: Partial<Record<Field, string>>;
}

/**
 * A same-site path to redirect to after login, or `fallback`. Rejects absolute and
 * protocol-relative URLs (`//evil.com`, `/\evil.com`) so `redirectTo` can't send users away.
 */
export function safeRedirect(to: unknown, fallback: string): string {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//") || to.includes("\\")) {
    return fallback;
  }
  return to;
}

/** The login URL, in `url`'s language (#84), that returns to `url` (path and query) afterwards. */
export function loginRedirectPath(url: URL): string {
  const search = new URLSearchParams({ redirectTo: url.pathname + url.search });
  return pathFor(localeFromPath(url.pathname), "login", {}, { search });
}

/**
 * Where a new customer came from, for `users.acquisition_channel`: the `utm_source` parameter,
 * otherwise the host of an external referrer (without `www.`), otherwise `"direct"`.
 */
export function resolveAcquisitionChannel(url: URL, referer: string | null): string {
  const utmSource = url.searchParams.get("utm_source")?.trim().toLowerCase();
  if (utmSource) return utmSource.slice(0, 100);

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host !== url.host && refererUrl.hostname) {
        return refererUrl.hostname.replace(/^www\./, "").slice(0, 100);
      }
    } catch {
      // Not a URL: treat as no referrer.
    }
  }

  return "direct";
}
