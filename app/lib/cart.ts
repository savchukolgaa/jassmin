// Cart form contract shared by the cart route's `action` and the forms that post to it, plus the
// cart DTOs its `loader` returns.
import type { CartIntent } from "./cart.schema";
import type { CartPromo, DiscountLine } from "./discounts";
import { createTranslator, type TextKey, type Translator } from "./i18n";
import type { ResponsiveImage } from "./images";

/** Most of one size a single cart line may hold, whatever the stock. */
export const MAX_LINE_QUANTITY = 99;

export type { CartActionInput, CartIntent } from "./cart.schema";

/** One cart line (one size of a perfume). Prices are exact decimal strings. */
export interface CartLine {
  /** The variant's `public_id`; identifies the line in update and remove forms. */
  variantId: string;
  /** The product's `public_id`. */
  productId: string;
  /** The product's URL slug (#83); link with `productHref({ id: productId, slug })`. */
  slug: string | null;
  title: string;
  brand: string;
  /** The primary fragrance family (stored Ukrainian value), for the label card (#99). */
  fragranceFamily: string | null;
  /** The product photo (#88); `null` without one. */
  image: ResponsiveImage | null;
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
  /** The one discount that applies (#59), or `null`. */
  discount: DiscountLine | null;
  /** `subtotal − discount`: what checkout charges, and what free delivery is decided on. */
  total: string;
  /** The promo code the shopper applied, and whether it's used. */
  promo: CartPromo | null;
}

export const EMPTY_CART: CartView = {
  lines: [],
  itemCount: 0,
  subtotal: "0.00",
  discount: null,
  total: "0.00",
  promo: null,
};

export type CartActionError =
  | "invalid"
  | "invalid-variant"
  | "out-of-stock"
  | "exceeds-stock"
  | "not-in-cart"
  /** The reminded cart can't be brought back any more (#139). */
  | "not-restorable"
  | PromoError;

/** Why a promo code couldn't be applied (#59). */
export type PromoError =
  | "promo-invalid"
  | "promo-expired"
  | "promo-used-up"
  | "promo-not-applicable"
  | "promo-rate-limited";

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
  "not-restorable": "cart.errors.notRestorable",
  "promo-invalid": "cart.errors.promoInvalid",
  "promo-expired": "cart.errors.promoExpired",
  "promo-used-up": "cart.errors.promoUsedUp",
  "promo-not-applicable": "cart.errors.promoNotApplicable",
  "promo-rate-limited": "cart.errors.promoRateLimited",
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
