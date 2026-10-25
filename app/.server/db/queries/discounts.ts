// Discount rules (#59). Pricing itself is `priceCart` (`services/pricing.ts`); these queries load
// the candidate rules for a cart and count a redemption at checkout.
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PricingDiscount } from "../../services/pricing";
import type { Db } from "../client";
import { carts, discounts } from "../schema";

/** A `Db` or a transaction, so services can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

const pricingColumns = {
  id: discounts.id,
  code: discounts.code,
  kind: discounts.kind,
  value: discounts.value,
  scopeVolumesMl: discounts.scopeVolumesMl,
  scopeProductPublicIds: discounts.scopeProductPublicIds,
  scopePackSize: discounts.scopePackSize,
  minQuantity: discounts.minQuantity,
  maxSets: discounts.maxSets,
  startsAt: discounts.startsAt,
  endsAt: discounts.endsAt,
  maxRedemptions: discounts.maxRedemptions,
  redemptionCount: discounts.redemptionCount,
  active: discounts.active,
};

/** The rule with this code, whatever its case, active or not; `undefined` when there's none. */
export async function findDiscountByCode(
  db: Executor,
  code: string,
): Promise<PricingDiscount | undefined> {
  const [row] = await db
    .select(pricingColumns)
    .from(discounts)
    .where(sql`lower(${discounts.code}) = lower(${code})`)
    .limit(1);
  return row;
}

/**
 * The automatic rules (no code, active) plus the cart's promo code even when it's no longer
 * active, so the cart can say why it stopped working. Pricing checks the windows and limits.
 */
function candidatesWhere(cartDiscountId: number | null) {
  const automatic = and(isNull(discounts.code), eq(discounts.active, true));
  return cartDiscountId === null ? automatic : or(automatic, eq(discounts.id, cartDiscountId));
}

export function listCandidateDiscounts(
  db: Executor,
  cartDiscountId: number | null,
): Promise<PricingDiscount[]> {
  return db
    .select(pricingColumns)
    .from(discounts)
    .where(candidatesWhere(cartDiscountId))
    .orderBy(asc(discounts.id));
}

/**
 * Counts one more order for the rule unless it's used up; returns whether it did. The row stays
 * locked until the transaction ends, so a concurrent checkout's increment waits for it and then
 * sees the new count. The `discounts_redemptions_check` constraint is the last guard.
 */
export async function redeemDiscount(db: Executor, discountId: number): Promise<boolean> {
  const rows = await db
    .update(discounts)
    .set({ redemptionCount: sql`${discounts.redemptionCount} + 1` })
    .where(
      and(
        eq(discounts.id, discountId),
        or(
          isNull(discounts.maxRedemptions),
          lt(discounts.redemptionCount, discounts.maxRedemptions),
        ),
      ),
    )
    .returning({ id: discounts.id });
  return rows.length > 0;
}

/** The promo code the shopper applied to the cart (`discounts.id`), or `null`. */
export async function findCartDiscountId(db: Executor, cartId: number): Promise<number | null> {
  const [row] = await db
    .select({ discountId: carts.discountId })
    .from(carts)
    .where(eq(carts.id, cartId))
    .limit(1);
  return row?.discountId ?? null;
}

/** Stores (or with `null` clears) the cart's promo code; `$onUpdate` bumps its `updated_at`. */
export async function setCartDiscount(
  db: Executor,
  cartId: number,
  discountId: number | null,
): Promise<void> {
  await db.update(carts).set({ discountId }).where(eq(carts.id, cartId));
}
