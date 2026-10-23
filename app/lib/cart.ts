// Cart form contract shared by the cart route's `action` and the forms that post to it.
import { z } from "zod";

export const addToCartSchema = z.object({
  intent: z.literal("add"),
  productId: z.uuid(),
  /** The chosen size's `public_id`; the action checks it belongs to the product. */
  variantId: z.uuid(),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;

/** Most of one size a single cart line may hold, whatever the stock. */
export const MAX_LINE_QUANTITY = 99;

/** One cart line (one size of a perfume). Prices are exact decimal strings. */
export interface CartLine {
  /** The variant's `public_id`; identifies the line in update and remove forms. */
  variantId: string;
  /** The product's `public_id`, for the product link. */
  productId: string;
  title: string;
  brand: string;
  imageUrl: string | null;
  packSize: number;
  volumeMl: number;
  /** The variant's current price. */
  unitPrice: string;
  quantity: number;
  /** The variant's stock now; may have dropped below `quantity` since the line was added. */
  stockQuantity: number;
  /** `unitPrice × quantity`, computed by the database. */
  lineTotal: string;
}

export interface CartView {
  /** Oldest first. */
  lines: CartLine[];
  /** Units across all lines (the header badge). */
  itemCount: number;
  subtotal: string;
}

export const EMPTY_CART: CartView = { lines: [], itemCount: 0, subtotal: "0.00" };

export type CartActionError =
  | "invalid"
  | "invalid-variant"
  | "out-of-stock"
  | "cart-unavailable"
  | "exceeds-stock"
  | "not-in-cart";

export type CartActionResult = { ok: true } | { ok: false; error: CartActionError };

export const CART_ERROR_MESSAGES: Record<CartActionError, string> = {
  invalid: "This perfume could not be added to the cart.",
  "invalid-variant": "Please choose one of the available volumes.",
  "out-of-stock": "This volume is out of stock.",
  "cart-unavailable": "The cart is coming soon.",
  "exceeds-stock": "There isn't enough of this volume in stock.",
  "not-in-cart": "This perfume is no longer in your cart.",
};

/** Validates an add-to-cart submission. */
export function parseAddToCart(formData: FormData) {
  return addToCartSchema.safeParse(Object.fromEntries(formData));
}
