// The cart form's zod schema, used by the cart route's `action`. Imported only by route actions,
// server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";
import { MAX_LINE_QUANTITY } from "./cart";
import { promoCodeSchema } from "./discounts.schema";

const quantity = z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY);

export const cartActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("add"),
    productId: z.uuid(),
    /** The chosen size's `public_id`; the action checks it belongs to the product. */
    variantId: z.uuid(),
    quantity: quantity.default(1),
  }),
  /** `variantId` identifies the line; the stepper posts the new quantity. */
  z.object({ intent: z.literal("update"), variantId: z.uuid(), quantity }),
  z.object({ intent: z.literal("remove"), variantId: z.uuid() }),
  /** Promo codes (#59): the code is trimmed and uppercased. */
  z.object({ intent: z.literal("apply-promo"), code: promoCodeSchema }),
  z.object({ intent: z.literal("remove-promo") }),
  /** Brings back the abandoned cart a reminder email offered (#139); the action checks it. */
  z.object({ intent: z.literal("restore"), cartId: z.coerce.number().int().positive() }),
]);

export type CartActionInput = z.infer<typeof cartActionSchema>;

export type CartIntent = CartActionInput["intent"];

/** Validates a cart form submission (any of the intents above). */
export function parseCartAction(formData: FormData) {
  return cartActionSchema.safeParse(Object.fromEntries(formData));
}
