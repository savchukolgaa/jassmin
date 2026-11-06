// zod schemas for the login, register and profile forms. Imported only by route actions, server
// code and tests, so zod stays out of the client bundle (#96). Error messages are message keys.
import { z } from "zod";
import { PROFILE_INTENTS } from "./auth";
import { isTextKey, msg, type TextKey } from "./i18n";

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

/**
 * A consent checkbox (#128): ticked posts `on`, unticked posts nothing. Anything else counts as
 * not ticked, so a consent is never assumed.
 */
export const checkboxSchema = z
  .string()
  .optional()
  .transform((value) => value === "on");

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
  /** Consent to marketing emails (#128); unticked by default. */
  marketingOptIn: checkboxSchema,
  redirectTo: optionalText,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, msg("auth.errors.passwordRequired")),
  redirectTo: optionalText,
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The token in an emailed link (#135): 32 bytes in base64url. Anything else can't be one of ours,
 * and the page treats it like an unknown token.
 */
export const authTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const forgotPasswordSchema = z.object({ email: emailSchema });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** A new password set through a reset link: the registration rules, typed twice. */
export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, {
    message: msg("auth.errors.passwordMismatch"),
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** The account page's "send it again" button (#135). */
export const resendVerificationSchema = z.object({ intent: z.literal("resend-verification") });

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
