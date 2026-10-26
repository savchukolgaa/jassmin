import { TESTER_TRIO_DISCOUNT_SLUG } from "~/lib/discounts";
import type { TrioOffer } from "~/lib/trio";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { findDiscountBySlug } from "../db/queries/discounts";
import { discountAvailability, type PricingDiscount } from "./pricing";

/**
 * The tester trio as checkout would price it right now (#59), or `null` when the rule can't be
 * applied: missing, not a set price, inactive, outside its window or used up.
 */
export function toTrioOffer(rule: PricingDiscount | undefined, now: Date): TrioOffer | null {
  if (rule?.kind !== "fixed_price_set" || discountAvailability(rule, now) !== "available") {
    return null;
  }
  const [volumeMl] = rule.scopeVolumesMl ?? [];
  return { price: rule.value, setSize: rule.minQuantity, volumeMl: volumeMl ?? null };
}

/** The live tester-trio offer for the home page (#64). */
export async function getTesterTrioOffer(
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<TrioOffer | null> {
  return toTrioOffer(await findDiscountBySlug(db, TESTER_TRIO_DISCOUNT_SLUG), now);
}
