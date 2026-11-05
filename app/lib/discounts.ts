// Promo codes and discount DTOs (#59), shared by the cart route, its forms and the order pages.
// Isomorphic: no server imports. Error messages are message keys, translated when rendered.
import type { DiscountKind } from "./enums";
import { createTranslator, type TextKey, type Translator } from "./i18n";

/** `discounts.slug` of the automatic tester-trio rule, the price the home page advertises. */
export const TESTER_TRIO_DISCOUNT_SLUG = "tester-trio";

/** `discounts.slug` of the automatic couple offer (#124): 15% off every second full bottle. */
export const COUPLE_OFFER_DISCOUNT_SLUG = "couple-15";

/** Longest code `discounts.code` holds. */
export const MAX_PROMO_CODE_LENGTH = 40;

/** Codes are stored uppercase; whatever the shopper types is trimmed and uppercased first. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Where the cart's promo code stands: `applied`; `not-best` when an automatic rule saves more (the
 * code stays on the cart but isn't used); `not-applicable` when the cart doesn't qualify;
 * `invalid` (unknown, inactive or not started yet), `expired` or `used-up`.
 */
export type PromoStatus =
  | "applied"
  | "not-best"
  | "not-applicable"
  | "invalid"
  | "expired"
  | "used-up";

/** The discount applied to a cart or an order, as its summary shows it. Amounts are strings. */
export interface DiscountLine {
  amount: string;
  /** The promo code, or `null` for an automatic rule. */
  code: string | null;
  kind: DiscountKind;
}

/** The promo code on a cart and whether it's used. */
export interface CartPromo {
  code: string;
  status: PromoStatus;
}

/** The label of an automatic rule, by kind: the tester trio, the couple offer or a plain one. */
const AUTOMATIC_DISCOUNT_KEYS: Record<DiscountKind, TextKey> = {
  percent: "checkout.discount",
  fixed_amount: "checkout.discount",
  fixed_price_set: "checkout.discountTesterSet",
  percent_every_nth: "checkout.discountCouple",
};

/**
 * The discount line's label: the promo code when there is one; else the automatic rule's own
 * label (the tester trio, a fixed-price set, or the couple offer, #124); else a plain "Discount".
 */
export function discountLabel(
  discount: Pick<DiscountLine, "code" | "kind">,
  { t }: Translator = createTranslator(),
): string {
  if (discount.code !== null) {
    return t("checkout.discountWithCode", { code: discount.code });
  }
  return t(AUTOMATIC_DISCOUNT_KEYS[discount.kind]);
}

/** What the cart says about its stored promo code, by status. */
export const PROMO_STATUS_KEYS: Record<PromoStatus, TextKey> = {
  applied: "cart.promo.applied",
  "not-best": "cart.promo.notBest",
  "not-applicable": "cart.promo.notApplicable",
  expired: "cart.promo.expired",
  invalid: "cart.promo.unavailable",
  "used-up": "cart.promo.unavailable",
};
