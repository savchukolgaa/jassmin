import { z } from "zod";
import {
  CONTACT_LIMITS,
  type ContactField,
  type ContactFieldErrors,
  type ContactValues,
  HONEYPOT_FIELD,
} from "~/lib/contact";

export const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name.")
    .max(CONTACT_LIMITS.nameMax, `Your name can be at most ${CONTACT_LIMITS.nameMax} characters.`),
  email: z
    .string()
    .trim()
    .min(1, "Please enter your email address.")
    .max(CONTACT_LIMITS.emailMax, "This email address is too long.")
    .pipe(z.email("Please enter a valid email address.")),
  message: z
    .string()
    .trim()
    .min(
      CONTACT_LIMITS.messageMin,
      `Your message needs at least ${CONTACT_LIMITS.messageMin} characters.`,
    )
    .max(
      CONTACT_LIMITS.messageMax,
      `Your message can be at most ${CONTACT_LIMITS.messageMax} characters.`,
    ),
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
        errors[field] = first;
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
