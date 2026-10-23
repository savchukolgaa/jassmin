// Cart form contract shared by the cart route's `action` and the forms that post to it, plus the
// cart DTOs its `loader` returns.
import { z } from "zod";
import { createTranslator, type TextKey, type Translator } from "./i18n";

/** Most of one size a single cart line may hold, whatever the stock. */
export const MAX_LINE_QUANTITY = 99;

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
]);

export type CartActionInput = z.infer<typeof cartActionSchema>;

export type CartIntent = CartActionInput["intent"];

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
  | "exceeds-stock"
  | "not-in-cart";

export type CartActionResult =
  | { ok: true; intent: CartIntent }
  /** `available` is the variant's stock, for `exceeds-stock`. */
  | { ok: false; error: CartActionError; available?: number };

export const CART_ERROR_KEYS: Record<CartActionError, TextKey> = {
  invalid: "cart.errors.invalid",
  "invalid-variant": "cart.errors.invalidVariant",
  "out-of-stock": "cart.errors.outOfStock",
  "exceeds-stock": "cart.errors.exceedsStock",
  "not-in-cart": "cart.errors.notInCart",
};

/**
 * The message for a failed cart action in the translator's locale, with the stock left when it's
 * known.
 */
export function cartErrorMessage(
  result: { error: CartActionError; available?: number },
  { t }: Translator = createTranslator(),
): string {
  if (result.error === "exceeds-stock" && result.available !== undefined) {
    return result.available > 0
      ? t("cart.errors.onlyAvailable", { count: result.available })
      : t(CART_ERROR_KEYS["out-of-stock"]);
  }
  return t(CART_ERROR_KEYS[result.error]);
}

/** Validates a cart form submission (`add`, `update` or `remove`). */
export function parseCartAction(formData: FormData) {
  return cartActionSchema.safeParse(Object.fromEntries(formData));
}
