// The gift card forms' zod schemas (#125): buying a card and applying a code at checkout. Imported
// only by route actions, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { emailSchema } from "./auth.schema";
import { type GiftCardAmount, isGiftCardAmount, MAX_GIFT_CARD_CODE_INPUT } from "./gift-cards";
import { msg } from "./i18n";

/** The buy form on the gift card page. */
export const giftCardPurchaseSchema = z.object({
  amount: z
    .string({ error: msg("giftCards.errors.amountRequired") })
    .refine((value) => /^\d+$/.test(value) && isGiftCardAmount(Number(value)), {
      message: msg("giftCards.errors.amountRequired"),
    })
    .transform((value) => Number(value) as GiftCardAmount),
  email: emailSchema,
  /** Who the card is for; blank or missing means the buyer passes the code on themselves. */
  recipientEmail: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(emailSchema.optional()),
});

export type GiftCardPurchaseInput = z.infer<typeof giftCardPurchaseSchema>;

export const GIFT_CARD_PURCHASE_FIELDS = ["amount", "email", "recipientEmail"] as const;

/** Validates a gift card purchase. */
export function parseGiftCardPurchase(formData: FormData) {
  return giftCardPurchaseSchema.safeParse(Object.fromEntries(formData));
}

/** The code field at checkout; whether the code exists is the service's to say. */
export const giftCardCodeSchema = z.object({
  code: z
    .string({ error: msg("checkout.giftCard.errors.unknown") })
    .trim()
    .min(1, msg("checkout.giftCard.errors.unknown"))
    .max(MAX_GIFT_CARD_CODE_INPUT, msg("checkout.giftCard.errors.unknown")),
});
