// Cart form contract shared by the cart route's `action` and the forms that post to it.
import { z } from "zod";
import type { TextKey } from "./i18n";

export const addToCartSchema = z.object({
  intent: z.literal("add"),
  productId: z.uuid(),
  /** The chosen size's `public_id`; the action checks it belongs to the product. */
  variantId: z.uuid(),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;

export type CartActionError = "invalid" | "invalid-variant" | "out-of-stock" | "cart-unavailable";

export type CartActionResult = { ok: true } | { ok: false; error: CartActionError };

export const CART_ERROR_KEYS: Record<CartActionError, TextKey> = {
  invalid: "cart.errors.invalid",
  "invalid-variant": "cart.errors.invalidVariant",
  "out-of-stock": "cart.errors.outOfStock",
  "cart-unavailable": "cart.errors.unavailable",
};

/** Validates an add-to-cart submission. */
export function parseAddToCart(formData: FormData) {
  return addToCartSchema.safeParse(Object.fromEntries(formData));
}
