// Cart pricing with discount rules (#59). Pure and synchronous: the cart page and checkout pass the
// lines and the candidate rules they loaded, and checkout does so inside its transaction with the
// rows locked, so both work out the same price. Every amount is whole kopiyky (exact integers), so
// there's no float rounding; callers convert with `toKopiyky` / `fromKopiyky` from `~/lib/money`.
//
// One discount per order: the rule that saves the shopper the most. A rule with a `code` is a
// candidate only when the shopper entered it; ties go to that code, then to the older rule.
// Discounts never touch shipping, and free delivery is decided on the discounted subtotal.
// Rule kinds: `percent` and `fixed_amount` of the qualifying units, `fixed_price_set` (the tester
// trio) and `percent_every_nth` (the couple offer, #124: a percent off every n-th unit).
import { FREE_SHIPPING_THRESHOLD, SHIPPING_AMOUNT } from "~/lib/checkout";
import type { Discount } from "~/lib/commerce";
import type { DiscountLine, PromoStatus } from "~/lib/discounts";
import type { DiscountKind } from "~/lib/enums";
import { fromKopiyky, toKopiyky } from "~/lib/money";

/** One cart line, priced in kopiyky. */
export interface PricingLine {
  /** The product's `public_id`, for product-scoped rules. */
  productPublicId: string;
  /** Volume of one unit. */
  volumeMl: number;
  packSize: number;
  unitPrice: number;
  quantity: number;
}

/** What pricing needs of a `discounts` row. */
export type PricingDiscount = Pick<
  Discount,
  | "id"
  | "code"
  | "kind"
  | "value"
  | "scopeVolumesMl"
  | "scopeProductPublicIds"
  | "scopePackSize"
  | "minQuantity"
  | "maxSets"
  | "startsAt"
  | "endsAt"
  | "maxRedemptions"
  | "redemptionCount"
  | "active"
>;

export interface AppliedDiscount {
  discountId: number;
  code: string | null;
  kind: DiscountKind;
  amount: number;
}

export interface PricedCart {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  /** The store pays delivery: `subtotal - discount` reaches `FREE_SHIPPING_THRESHOLD`. */
  freeShipping: boolean;
  applied: AppliedDiscount | null;
  /** The entered promo code (a candidate with a `code`) and whether it's used. */
  promo: { discountId: number; code: string; status: PromoStatus } | null;
}

/** Whether the rule can be used at `now`, else why not. */
export type DiscountAvailability = "available" | "invalid" | "expired" | "used-up";

export function discountAvailability(discount: PricingDiscount, now: Date): DiscountAvailability {
  // A rule that hasn't started yet looks like an unknown code, so codes don't leak early.
  if (!discount.active || (discount.startsAt !== null && now < discount.startsAt)) {
    return "invalid";
  }
  if (discount.endsAt !== null && now >= discount.endsAt) {
    return "expired";
  }
  if (discount.maxRedemptions !== null && discount.redemptionCount >= discount.maxRedemptions) {
    return "used-up";
  }
  return "available";
}

function qualifies(line: PricingLine, discount: PricingDiscount): boolean {
  return (
    (discount.scopeVolumesMl === null || discount.scopeVolumesMl.includes(line.volumeMl)) &&
    (discount.scopeProductPublicIds === null ||
      discount.scopeProductPublicIds.includes(line.productPublicId)) &&
    (discount.scopePackSize === null || discount.scopePackSize === line.packSize)
  );
}

/**
 * What the rule takes off these lines, ignoring its availability: `0` when the cart doesn't
 * qualify. Never more than the lines' subtotal.
 */
export function discountSaving(lines: readonly PricingLine[], discount: PricingDiscount): number {
  // One price per unit, most expensive first, so sets take the dearest units.
  const units = lines
    .filter((line) => qualifies(line, discount))
    .flatMap((line) => Array.from({ length: line.quantity }, () => line.unitPrice))
    .sort((a, b) => b - a);
  if (units.length < discount.minQuantity) {
    return 0;
  }
  const sum = units.reduce((total, price) => total + price, 0);
  const value = toKopiyky(discount.value);

  let saving: number;
  switch (discount.kind) {
    case "percent":
      // `value` is the percent; in kopiyky it's hundredths of a percent. Rounded down, so the
      // store never takes off more than it advertises.
      saving = Math.floor((sum * value) / 10_000);
      break;
    case "fixed_amount":
      saving = Math.min(value, sum);
      break;
    case "fixed_price_set": {
      const sets = Math.min(
        Math.floor(units.length / discount.minQuantity),
        discount.maxSets ?? Number.POSITIVE_INFINITY,
      );
      const inSets = units
        .slice(0, sets * discount.minQuantity)
        .reduce((total, price) => total + price, 0);
      saving = inSets - sets * value;
      break;
    }
    case "percent_every_nth": {
      // The couple offer (#124): units are grouped dearest first, and the last (cheapest) unit
      // of each full group gets `value`% off, at most `max_sets` groups. Rounded down once.
      const groups = Math.min(
        Math.floor(units.length / discount.minQuantity),
        discount.maxSets ?? Number.POSITIVE_INFINITY,
      );
      let discounted = 0;
      for (let group = 1; group <= groups; group++) {
        discounted += units[group * discount.minQuantity - 1] ?? 0;
      }
      saving = Math.floor((discounted * value) / 10_000);
      break;
    }
  }
  const subtotal = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  return Math.min(Math.max(saving, 0), subtotal);
}

/** Prices the lines with the best of the candidate rules at `now`. */
export function priceCart(
  lines: readonly PricingLine[],
  candidates: readonly PricingDiscount[],
  now: Date,
): PricedCart {
  const subtotal = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);

  let best: { discount: PricingDiscount; saving: number } | null = null;
  const savings = new Map<number, number>();
  for (const discount of candidates) {
    if (discountAvailability(discount, now) !== "available") continue;
    const saving = discountSaving(lines, discount);
    savings.set(discount.id, saving);
    if (saving <= 0) continue;
    if (
      best === null ||
      saving > best.saving ||
      (saving === best.saving && isPreferred(discount, best.discount))
    ) {
      best = { discount, saving };
    }
  }

  const discount = best?.saving ?? 0;
  const shipping = toKopiyky(SHIPPING_AMOUNT);
  const applied =
    best === null
      ? null
      : {
          discountId: best.discount.id,
          code: best.discount.code,
          kind: best.discount.kind,
          amount: best.saving,
        };
  return {
    subtotal,
    discount,
    shipping,
    total: subtotal - discount + shipping,
    freeShipping: subtotal - discount >= toKopiyky(FREE_SHIPPING_THRESHOLD),
    applied,
    promo: promoState(candidates, savings, applied, now),
  };
}

/** On equal savings the entered code wins, then the older rule. */
function isPreferred(a: PricingDiscount, b: PricingDiscount): boolean {
  if ((a.code !== null) !== (b.code !== null)) {
    return a.code !== null;
  }
  return a.id < b.id;
}

function promoState(
  candidates: readonly PricingDiscount[],
  savings: ReadonlyMap<number, number>,
  applied: AppliedDiscount | null,
  now: Date,
): PricedCart["promo"] {
  const promo = candidates.find((discount) => discount.code !== null);
  if (!promo || promo.code === null) {
    return null;
  }
  const availability = discountAvailability(promo, now);
  let status: PromoStatus;
  if (availability !== "available") {
    status = availability;
  } else if (applied?.discountId === promo.id) {
    status = "applied";
  } else if ((savings.get(promo.id) ?? 0) > 0) {
    status = "not-best";
  } else {
    status = "not-applicable";
  }
  return { discountId: promo.id, code: promo.code, status };
}

/** The applied discount as summaries show it, or `null`. */
export function toDiscountLine(applied: AppliedDiscount | null): DiscountLine | null {
  return applied === null
    ? null
    : { amount: fromKopiyky(applied.amount), code: applied.code, kind: applied.kind };
}
