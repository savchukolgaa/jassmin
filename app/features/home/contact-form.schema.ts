import { z } from "zod";
import {
  CONTACT_LIMITS,
  type ContactField,
  type ContactFieldErrors,
  type ContactValues,
  HONEYPOT_FIELD,
} from "~/lib/contact";
import { msg } from "~/lib/i18n";
import { isTextKey } from "~/lib/i18n/dictionaries";

export const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, msg("contact.errors.nameRequired"))
    .max(CONTACT_LIMITS.nameMax, msg("contact.errors.nameTooLong")),
  email: z
    .string()
    .trim()
    .min(1, msg("contact.errors.emailRequired"))
    .max(CONTACT_LIMITS.emailMax, msg("contact.errors.emailTooLong"))
    .pipe(z.email(msg("contact.errors.emailInvalid"))),
  message: z
    .string()
    .trim()
    .min(CONTACT_LIMITS.messageMin, msg("contact.errors.messageTooShort"))
    .max(CONTACT_LIMITS.messageMax, msg("contact.errors.messageTooLong")),
});

export type ContactMessage = z.infer<typeof contactFormSchema>;

export type ParsedContactForm =
  | { ok: true; data: ContactMessage; honeypot: boolean }
  | { ok: false; fieldErrors: ContactFieldErrors; values: ContactValues };

const FIELDS: readonly ContactField[] = ["name", "email", "message"];

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Validates a contact form submission; never throws for user mistakes. */
export function parseContactForm(formData: FormData): ParsedContactForm {
  const values: ContactValues = {
    name: text(formData, "name"),
    email: text(formData, "email"),
    message: text(formData, "message"),
  };
  const result = contactFormSchema.safeParse(values);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    const errors: ContactFieldErrors = {};
    for (const field of FIELDS) {
      const [first] = fieldErrors[field] ?? [];
      if (first) {
        errors[field] = isTextKey(first) ? first : "errors.invalid";
      }
    }
    return { ok: false, fieldErrors: errors, values };
  }
  return {
    ok: true,
    data: result.data,
    honeypot: text(formData, HONEYPOT_FIELD).trim() !== "",
  };
}
