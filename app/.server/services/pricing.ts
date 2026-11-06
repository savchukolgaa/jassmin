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
// The discount is also split over the lines (#128, `allocation`): over the units the rule took
// money off, in proportion to their prices, so margin per product can be measured.
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
  /**
   * Each line's share of `discount` (#128), in the order of the `lines` given: the units the
   * rule took money off share it in proportion to their prices, rounded down to kopiyky, and the
   * rest goes on the line with the largest share of those units. Adds up to `discount` exactly;
   * all zeros without a discount.
   */
  allocation: number[];
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

/** One unit the rule takes money off, with the line it belongs to. */
interface DiscountedUnit {
  lineIndex: number;
  price: number;
}

/**
 * What the rule takes off these lines, ignoring its availability, and the units it takes it off:
 * every qualifying unit for `percent` and `fixed_amount`, the units in the counted sets for
 * `fixed_price_set`, and the discounted n-th units for `percent_every_nth`. The saving is `0`
 * (and no units) when the cart doesn't qualify, and never more than the lines' subtotal.
 */
function discountedUnits(
  lines: readonly PricingLine[],
  discount: PricingDiscount,
): { saving: number; units: DiscountedUnit[] } {
  // One price per unit, most expensive first, so sets take the dearest units. The sort is
  // stable, so equal prices keep the line order.
  const qualifying = lines
    .flatMap((line, lineIndex) =>
      qualifies(line, discount)
        ? Array.from({ length: line.quantity }, () => ({ lineIndex, price: line.unitPrice }))
        : [],
    )
    .sort((a, b) => b.price - a.price);
  if (qualifying.length < discount.minQuantity) {
    return { saving: 0, units: [] };
  }
  const total = (units: readonly DiscountedUnit[]) =>
    units.reduce((sum, unit) => sum + unit.price, 0);
  const value = toKopiyky(discount.value);

  let saving: number;
  let units: DiscountedUnit[];
  switch (discount.kind) {
    case "percent":
      // `value` is the percent; in kopiyky it's hundredths of a percent. Rounded down, so the
      // store never takes off more than it advertises.
      units = qualifying;
      saving = Math.floor((total(units) * value) / 10_000);
      break;
    case "fixed_amount":
      units = qualifying;
      saving = Math.min(value, total(units));
      break;
    case "fixed_price_set": {
      const sets = Math.min(
        Math.floor(qualifying.length / discount.minQuantity),
        discount.maxSets ?? Number.POSITIVE_INFINITY,
      );
      units = qualifying.slice(0, sets * discount.minQuantity);
      saving = total(units) - sets * value;
      break;
    }
    case "percent_every_nth": {
      // The couple offer (#124): units are grouped dearest first, and the last (cheapest) unit
      // of each full group gets `value`% off, at most `max_sets` groups. Rounded down once.
      const groups = Math.min(
        Math.floor(qualifying.length / discount.minQuantity),
        discount.maxSets ?? Number.POSITIVE_INFINITY,
      );
      units = [];
      for (let group = 1; group <= groups; group++) {
        const unit = qualifying[group * discount.minQuantity - 1];
        if (unit) units.push(unit);
      }
      saving = Math.floor((total(units) * value) / 10_000);
      break;
    }
  }
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  saving = Math.min(Math.max(saving, 0), subtotal);
  return saving > 0 ? { saving, units } : { saving: 0, units: [] };
}

/**
 * What the rule takes off these lines, ignoring its availability: `0` when the cart doesn't
 * qualify. Never more than the lines' subtotal.
 */
export function discountSaving(lines: readonly PricingLine[], discount: PricingDiscount): number {
  return discountedUnits(lines, discount).saving;
}

/**
 * Splits `saving` over `lineCount` lines in proportion to the prices of the discounted `units`,
 * rounded down to kopiyky, with the rest on the line whose units weigh the most (the first one
 * on a tie). The result always adds up to `saving`; lines without discounted units get 0.
 */
export function allocateDiscount(
  saving: number,
  units: readonly DiscountedUnit[],
  lineCount: number,
): number[] {
  const weights = new Array<number>(lineCount).fill(0);
  for (const unit of units) {
    weights[unit.lineIndex] = (weights[unit.lineIndex] ?? 0) + unit.price;
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (saving <= 0 || total <= 0) {
    return new Array<number>(lineCount).fill(0);
  }
  const shares = weights.map((weight) => Math.floor((saving * weight) / total));
  let largest = 0;
  weights.forEach((weight, index) => {
    if (weight > (weights[largest] ?? 0)) largest = index;
  });
  shares[largest] = (shares[largest] ?? 0) + saving - shares.reduce((sum, share) => sum + share, 0);
  return shares;
}

/** Prices the lines with the best of the candidate rules at `now`. */
export function priceCart(
  lines: readonly PricingLine[],
  candidates: readonly PricingDiscount[],
  now: Date,
): PricedCart {
  const subtotal = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);

  let best: { discount: PricingDiscount; saving: number; units: DiscountedUnit[] } | null = null;
  const savings = new Map<number, number>();
  for (const discount of candidates) {
    if (discountAvailability(discount, now) !== "available") continue;
    const { saving, units } = discountedUnits(lines, discount);
    savings.set(discount.id, saving);
    if (saving <= 0) continue;
    if (
      best === null ||
      saving > best.saving ||
      (saving === best.saving && isPreferred(discount, best.discount))
    ) {
      best = { discount, saving, units };
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
    allocation: allocateDiscount(discount, best?.units ?? [], lines.length),
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
