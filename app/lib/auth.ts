// Validation and helpers shared by the login/register routes and their forms. Isomorphic: no
// server imports. Error messages are message keys, translated when the form renders them.
import { z } from "zod";
import { isTextKey, msg, type TextKey } from "./i18n";
import { localeFromPath, pathFor } from "./paths";

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

/** Trimmed and lowercased, so `A@x.com` and `a@x.com` are the same account. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email(msg("auth.errors.emailInvalid")).max(255, msg("auth.errors.emailTooLong")));

/** An optional text field: blank or missing becomes `undefined`. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, msg("auth.errors.nameRequired"))
  .max(255, msg("auth.errors.nameTooLong"));

/** Optional: blank or missing becomes `undefined`. */
export const phoneSchema = optionalText.refine(
  (value) => value === undefined || PHONE.test(value),
  { message: msg("auth.errors.phoneInvalid") },
);

/** A password being set, at registration or in the profile. Not trimmed. */
export const newPasswordSchema = z
  .string()
  .min(8, msg("auth.errors.passwordTooShort"))
  .max(128, msg("auth.errors.passwordTooLong"));

export const registerSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  phone: phoneSchema,
  // Analytics only: an unusable value falls back to the column default instead of failing.
  acquisitionChannel: z.string().trim().toLowerCase().min(1).max(100).optional().catch(undefined),
  redirectTo: optionalText,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, msg("auth.errors.passwordRequired")),
  redirectTo: optionalText,
});

export type LoginInput = z.infer<typeof loginSchema>;

// The three forms of the account profile page (#54), told apart by a hidden `intent` field.
export const PROFILE_INTENTS = ["contact", "email", "password"] as const;
export type ProfileIntent = (typeof PROFILE_INTENTS)[number];
export const profileIntentSchema = z.enum(PROFILE_INTENTS);

const currentPasswordSchema = z
  .string()
  .min(1, msg("account.profile.errors.currentPasswordRequired"));

export const contactSchema = z.object({ fullName: fullNameSchema, phone: phoneSchema });

export type ContactInput = z.infer<typeof contactSchema>;

export const changeEmailSchema = z.object({
  email: emailSchema,
  currentPassword: currentPasswordSchema,
});

export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    newPassword: newPasswordSchema,
    confirmNewPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    message: msg("account.profile.errors.passwordMismatch"),
    path: ["confirmNewPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export type RegisterField = "fullName" | "email" | "password" | "phone";
export type LoginField = "email" | "password";
export type ContactField = "fullName" | "phone";
export type ChangeEmailField = "email" | "currentPassword";
export type ChangePasswordField = "currentPassword" | "newPassword" | "confirmNewPassword";

export interface ProfileFields {
  contact: ContactField;
  email: ChangeEmailField;
  password: ChangePasswordField;
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
 * The first message key per field of a failed parse. A message that isn't one of ours (e.g. a zod
 * default) becomes the generic `errors.invalid`.
 */
export function toFieldErrors<Field extends string>(
  error: z.ZodError,
  fields: readonly Field[],
): Partial<Record<Field, TextKey>> {
  const flattened: Partial<Record<string, string[]>> = z.flattenError(error).fieldErrors;
  const result: Partial<Record<Field, TextKey>> = {};
  for (const field of fields) {
    const message = flattened[field]?.[0];
    if (message) result[field] = isTextKey(message) ? message : "errors.invalid";
  }
  return result;
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
