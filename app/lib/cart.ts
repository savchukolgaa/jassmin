// Cart form contract shared by the cart route's `action` and the forms that post to it.
import { z } from "zod";

export const addToCartSchema = z.object({
  intent: z.literal("add"),
  productId: z.uuid(),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;

export type CartActionError = "invalid" | "cart-unavailable";

export type CartActionResult = { ok: true } | { ok: false; error: CartActionError };

export const CART_ERROR_MESSAGES: Record<CartActionError, string> = {
  invalid: "This perfume could not be added to the cart.",
  "cart-unavailable": "The cart is coming soon.",
};

/** Validates an add-to-cart submission. */
export function parseAddToCart(formData: FormData) {
  return addToCartSchema.safeParse(Object.fromEntries(formData));
}
