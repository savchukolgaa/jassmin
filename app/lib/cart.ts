// Cart form contract shared by the cart route's `action` and the forms that post to it.
import { z } from "zod";

export const addToCartSchema = z.object({
  intent: z.literal("add"),
  productId: z.uuid(),
  /** The chosen size's `public_id`; the action checks it belongs to the product. */
  variantId: z.uuid(),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;

export type CartActionError = "invalid" | "invalid-variant" | "out-of-stock" | "cart-unavailable";

export type CartActionResult = { ok: true } | { ok: false; error: CartActionError };

export const CART_ERROR_MESSAGES: Record<CartActionError, string> = {
  invalid: "This perfume could not be added to the cart.",
  "invalid-variant": "Please choose one of the available volumes.",
  "out-of-stock": "This volume is out of stock.",
  "cart-unavailable": "The cart is coming soon.",
};

/** Validates an add-to-cart submission. */
export function parseAddToCart(formData: FormData) {
  return addToCartSchema.safeParse(Object.fromEntries(formData));
}
