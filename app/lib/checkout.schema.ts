// The checkout form's zod schema (#11), used by the `/checkout` action. Imported only by route
// actions, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { emailSchema } from "./auth.schema";
import { normalizeUkrainianPhone } from "./checkout";
import { SELECTABLE_PAYMENT_METHODS } from "./enums";
import { msg, type TextKey } from "./i18n";

const requiredText = (max: number, required: TextKey, tooLong: TextKey) =>
  z
    .string({ error: msg(required) })
    .trim()
    .min(1, msg(required))
    .max(max, msg(tooLong));

export const checkoutSchema = z.object({
  fullName: requiredText(
    255,
    "checkout.errors.fullNameRequired",
    "checkout.errors.fullNameTooLong",
  ),
  email: emailSchema,
  // Normalised, so `orders.guest_phone` matches however the number was typed (identity resolution).
  phone: z.string({ error: msg("checkout.errors.phoneInvalid") }).transform((value, ctx) => {
    const phone = normalizeUkrainianPhone(value);
    if (phone === undefined) {
      ctx.addIssue({ code: "custom", message: msg("checkout.errors.phoneInvalid") });
      return z.NEVER;
    }
    return phone;
  }),
  city: requiredText(100, "checkout.errors.cityRequired", "checkout.errors.cityTooLong"),
  branch: requiredText(255, "checkout.errors.branchRequired", "checkout.errors.branchTooLong"),
  // `gift_card` is set by the shop when a gift card covers the order (#125), never posted.
  paymentMethod: z.enum(SELECTABLE_PAYMENT_METHODS, {
    error: msg("checkout.errors.paymentRequired"),
  }),
  /**
   * The total the page showed (#59), so the order is never placed at more: a code or offer may
   * stop working between loading the page and submitting it. Left out, it isn't checked.
   */
  expectedTotal: z
    .string()
    .regex(/^\d{1,8}(?:\.\d{1,2})?$/)
    .optional()
    .catch(undefined),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Validates a checkout form submission. */
export function parseCheckout(formData: FormData) {
  return checkoutSchema.safeParse(Object.fromEntries(formData));
}
