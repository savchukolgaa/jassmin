// Promo codes and discount DTOs (#59), shared by the cart route, its forms and the order pages.
// Isomorphic: no server imports. Error messages are message keys, translated when rendered.
import { z } from "zod";
import type { DiscountKind } from "./enums";
import { createTranslator, msg, type TextKey, type Translator } from "./i18n";

/** `discounts.slug` of the automatic tester-trio rule, the price the home page advertises. */
export const TESTER_TRIO_DISCOUNT_SLUG = "tester-trio";

/** Longest code `discounts.code` holds. */
export const MAX_PROMO_CODE_LENGTH = 40;

/** Codes are stored uppercase; whatever the shopper types is trimmed and uppercased first. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export const promoCodeSchema = z
  .string({ error: msg("cart.errors.promoInvalid") })
  .transform(normalizePromoCode)
  .pipe(
    z
      .string()
      .min(1, msg("cart.errors.promoInvalid"))
      .max(MAX_PROMO_CODE_LENGTH, msg("cart.errors.promoInvalid"))
      .regex(/^[A-Z0-9_-]+$/, msg("cart.errors.promoInvalid")),
  );

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

/**
 * The discount line's label: the promo code when there is one; else the tester trio, the only
 * automatic rule (a fixed-price set); else a plain "Discount".
 */
export function discountLabel(
  discount: Pick<DiscountLine, "code" | "kind">,
  { t }: Translator = createTranslator(),
): string {
  if (discount.code !== null) {
    return t("checkout.discountWithCode", { code: discount.code });
  }
  return t(
    discount.kind === "fixed_price_set" ? "checkout.discountTesterSet" : "checkout.discount",
  );
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
