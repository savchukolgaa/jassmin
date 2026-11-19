// What Strapi sends to `/cms/newsletters/:id/send` (#181): the newsletter as staff wrote it, and
// whether to send it or only send a test to the staff member. Imported only by the route and tests.
import { z } from "zod";
import {
  NEWSLETTER_BODY_MAX,
  NEWSLETTER_MAX_PRODUCTS,
  NEWSLETTER_PREHEADER_MAX,
  NEWSLETTER_SLUG_MAX,
  NEWSLETTER_SLUG_PATTERN,
  NEWSLETTER_SUBJECT_MAX,
  type NewsletterContent,
  type NewsletterText,
} from "./newsletter";

/** A trimmed string, `null` when blank or missing. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const textSchema = z.object({
  subject: z.string().trim().min(1).max(NEWSLETTER_SUBJECT_MAX),
  preheader: optionalText(NEWSLETTER_PREHEADER_MAX),
  body: z.string().trim().min(1).max(NEWSLETTER_BODY_MAX),
});

/** The English version: absent when every field is blank, else it needs a subject and a body. */
const englishSchema = z
  .object({
    subject: optionalText(NEWSLETTER_SUBJECT_MAX),
    preheader: optionalText(NEWSLETTER_PREHEADER_MAX),
    body: optionalText(NEWSLETTER_BODY_MAX),
  })
  .nullish()
  .superRefine((value, ctx) => {
    if (!value || (!value.subject && !value.preheader && !value.body)) return;
    for (const field of ["subject", "body"] as const) {
      if (!value[field]) {
        ctx.addIssue({ code: "custom", path: [field], message: "required-with-english" });
      }
    }
  })
  .transform((value): NewsletterText | null =>
    value?.subject && value.body
      ? { subject: value.subject, preheader: value.preheader, body: value.body }
      : null,
  );

const contentFields = {
  slug: z.string().trim().max(NEWSLETTER_SLUG_MAX).regex(NEWSLETTER_SLUG_PATTERN),
  content: z.object({ uk: textSchema, en: englishSchema }),
  productPublicIds: z
    .array(z.uuid())
    .max(NEWSLETTER_MAX_PRODUCTS)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: "duplicate-product",
    })
    .default([]),
};

function toContent({
  slug,
  content,
  productPublicIds,
}: {
  slug: string;
  content: { uk: NewsletterText; en: NewsletterText | null };
  productPublicIds: string[];
}): NewsletterContent {
  return {
    slug,
    uk: content.uk,
    en: content.en,
    productPublicIds: productPublicIds.map((id) => id.toLowerCase()),
  };
}

export const cmsNewsletterSendSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("send"), ...contentFields }).transform((input) => ({
    mode: "send" as const,
    content: toContent(input),
  })),
  z
    .object({
      mode: z.literal("test"),
      ...contentFields,
      // The admin user who pressed the button; Strapi takes it from the admin session.
      testEmail: z.string().trim().toLowerCase().pipe(z.email()),
      testName: z.string().trim().max(100).optional(),
    })
    .transform((input) => ({
      mode: "test" as const,
      content: toContent(input),
      to: {
        email: input.testEmail,
        name: input.testName || (input.testEmail.split("@")[0] ?? input.testEmail),
      },
    })),
]);

export type CmsNewsletterSend = z.output<typeof cmsNewsletterSendSchema>;
