// The visitor's active cart (#10): a guest's hangs off their analytics session, a user's off
// their `user_id`. Price and stock come from the chosen variant. Every change bumps
// `carts.updated_at`, which the abandoned-cart job (#19) relies on. The job may abandon a cart
// between a lookup and `lockCart`, so writes check the status the lock returns.
//
// Discounts (#59): the cart stores the promo code the shopper applied (`carts.discount_id`);
// automatic rules aren't stored. Every read prices the lines with `priceCart`, so the total
// follows line changes, and a stored code that stops applying says why.
import { and, eq, sql } from "drizzle-orm";
import {
  type CartActionError,
  type CartLine,
  type CartView,
  EMPTY_CART,
  type PromoError,
} from "~/lib/cart";
import type { PromoStatus } from "~/lib/discounts";
import { fromKopiyky, toKopiyky } from "~/lib/money";
import type { VisitorCookies } from "../analytics";
import { readVisitor } from "../analytics";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import {
  cartTotals,
  findActiveGuestCartId,
  findActiveUserCartId,
  findCartLine,
  insertActiveCart,
  listCartItemsWithStock,
  listCartLines,
  lockCart,
  touchCart,
} from "../db/queries/cart";
import {
  findCartDiscountId,
  findDiscountByCode,
  listCandidateDiscounts,
  setCartDiscount,
} from "../db/queries/discounts";
import { findUserById } from "../db/queries/users";
import { cartItems, carts } from "../db/schema";
import { getUserId } from "../session";
import { type PricingLine, priceCart, toDiscountLine } from "./pricing";

/** Whose cart to read: the logged-in user's, else the guest's (by their visitor cookies). */
export interface CartOwner extends VisitorCookies {
  userId: number | null;
}

/** Whose cart to change. A guest's cart needs their analytics session (`getVisitor`). */
export interface CartWriter {
  userId: number | null;
  anonymousId: string;
  sessionId: string;
}

/** The cart owner from the request's cookies, without creating anything. */
export async function getCartOwner(request: Request, db: Db = defaultDb): Promise<CartOwner> {
  const [userId, visitor] = await Promise.all([getUserId(request), readVisitor(request)]);
  // A stale cookie whose user no longer exists counts as a guest, like in the header.
  const user = userId === undefined ? undefined : await findUserById(db, userId);
  return { userId: user?.id ?? null, ...visitor };
}

/** The id of the owner's active cart, or `undefined` when they have none. */
export async function getActiveCartId(
  owner: CartOwner,
  db: Db = defaultDb,
): Promise<number | undefined> {
  if (owner.userId !== null) {
    return findActiveUserCartId(db, owner.userId);
  }
  return owner.anonymousId ? findActiveGuestCartId(db, owner.anonymousId) : undefined;
}

/** The id of the owner's active cart, created on first use. */
export async function getOrCreateActiveCart(
  writer: CartWriter,
  db: Db = defaultDb,
): Promise<number> {
  const existing = await getActiveCartId(writer, db);
  if (existing !== undefined) {
    return existing;
  }
  const created = await insertActiveCart(db, {
    userId: writer.userId,
    sessionId: writer.sessionId,
  });
  if (created !== undefined) {
    return created;
  }
  // A concurrent request created it first.
  const raced = await getActiveCartId(writer, db);
  if (raced === undefined) {
    throw new Error("Could not create or find the active cart");
  }
  return raced;
}

/** A cart line as `priceCart` takes it. */
export function pricingLine(line: CartLine): PricingLine {
  return {
    productPublicId: line.productId,
    volumeMl: line.volumeMl,
    packSize: line.packSize,
    unitPrice: toKopiyky(line.unitPrice),
    quantity: line.quantity,
  };
}

/** The owner's cart lines, totals and discount; empty when they have no cart. */
export async function getCartView(
  owner: CartOwner,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<CartView> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return EMPTY_CART;
  }
  const [lines, totals, cartDiscountId] = await Promise.all([
    listCartLines(db, cartId),
    cartTotals(db, cartId),
    findCartDiscountId(db, cartId),
  ]);
  const candidates = await listCandidateDiscounts(db, cartDiscountId);
  const priced = priceCart(lines.map(pricingLine), candidates, now);
  return {
    lines,
    ...totals,
    discount: toDiscountLine(priced.applied),
    total: fromKopiyky(priced.total),
    promo: priced.promo && { code: priced.promo.code, status: priced.promo.status },
  };
}

export type PromoResult = { ok: true; status: PromoStatus } | { ok: false; error: PromoError };

const PROMO_ERRORS: Partial<Record<PromoStatus, PromoError>> = {
  invalid: "promo-invalid",
  expired: "promo-expired",
  "used-up": "promo-used-up",
  "not-applicable": "promo-not-applicable",
};

/**
 * Applies a promo code (already normalised) to the owner's cart. It's stored only when it
 * applies to the cart now, also when an automatic rule saves more (`not-best`); otherwise the cart
 * keeps whatever code it had.
 */
export async function applyPromoCode(
  owner: CartOwner,
  code: string,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<PromoResult> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return { ok: false, error: "promo-not-applicable" };
  }
  return db.transaction(async (tx): Promise<PromoResult> => {
    if (!(await lockCart(tx, cartId))) {
      return { ok: false, error: "promo-not-applicable" };
    }
    const discount = await findDiscountByCode(tx, code);
    if (!discount) {
      return { ok: false, error: "promo-invalid" };
    }
    const [lines, candidates] = await Promise.all([
      listCartLines(tx, cartId),
      listCandidateDiscounts(tx, discount.id),
    ]);
    const status = priceCart(lines.map(pricingLine), candidates, now).promo?.status ?? "invalid";
    const error = PROMO_ERRORS[status];
    if (error) {
      return { ok: false, error };
    }
    await setCartDiscount(tx, cartId, discount.id);
    await touchCart(tx, cartId);
    return { ok: true, status };
  });
}

/** Takes the promo code off the owner's cart; a no-op without one. */
export async function removePromoCode(owner: CartOwner, db: Db = defaultDb): Promise<void> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return;
  }
  await db.transaction(async (tx) => {
    if (await lockCart(tx, cartId)) {
      await setCartDiscount(tx, cartId, null);
      await touchCart(tx, cartId);
    }
  });
}

/** Units in the owner's active cart, for the header badge. */
export async function getCartCount(owner: CartOwner, db: Db = defaultDb): Promise<number> {
  if (owner.userId === null && !owner.anonymousId) {
    return 0;
  }
  const cartId = await getActiveCartId(owner, db);
  return cartId === undefined ? 0 : (await cartTotals(db, cartId)).itemCount;
}

/** What a successful change did, for the `add_to_cart` / `remove_from_cart` events (#18). */
export interface CartChange {
  /** `products.id`. */
  productId: number;
  volumeMl: number;
  /** Units added (positive) or removed (negative). */
  quantityDelta: number;
}

export type CartChangeResult =
  | { ok: true; change: CartChange }
  | { ok: false; error: Extract<CartActionError, "exceeds-stock">; available: number }
  | { ok: false; error: Extract<CartActionError, "not-in-cart"> };

/** The variant to add, as returned by `checkVariantForCart`. */
export interface CartVariant {
  id: number;
  productId: number;
  volumeMl: number;
  stockQuantity: number;
}

/**
 * Adds `quantity` of the variant to the owner's cart (creating it), or adds to the line it
 * already has. The line may not exceed the variant's stock.
 */
export async function addItem(
  writer: CartWriter,
  variant: CartVariant,
  quantity: number,
  db: Db = defaultDb,
): Promise<CartChangeResult> {
  // If the abandoned-cart job marks the cart before we lock it, the second try gets a new cart.
  for (let attempt = 0; attempt < 2; attempt++) {
    const cartId = await getOrCreateActiveCart(writer, db);
    const result = await addToCart(cartId, variant, quantity, db);
    if (result !== undefined) {
      return result;
    }
  }
  throw new Error("The cart was abandoned while adding to it");
}

/** `addItem` for a known cart; `undefined` when the cart is no longer active. */
function addToCart(
  cartId: number,
  variant: CartVariant,
  quantity: number,
  db: Db,
): Promise<CartChangeResult | undefined> {
  return db.transaction(async (tx) => {
    if (!(await lockCart(tx, cartId))) {
      return undefined;
    }
    const [line] = await tx
      .select({ id: cartItems.id, quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variant.id)))
      .limit(1);
    const total = (line?.quantity ?? 0) + quantity;
    if (total > variant.stockQuantity) {
      return { ok: false, error: "exceeds-stock", available: variant.stockQuantity };
    }

    if (line) {
      await tx.update(cartItems).set({ quantity: total }).where(eq(cartItems.id, line.id));
    } else {
      await tx
        .insert(cartItems)
        .values({ cartId, productId: variant.productId, variantId: variant.id, quantity });
    }
    await touchCart(tx, cartId);
    return {
      ok: true,
      change: { productId: variant.productId, volumeMl: variant.volumeMl, quantityDelta: quantity },
    };
  });
}

/** The change to an existing line. */
function changeOf(
  line: { productId: number; volumeMl: number },
  quantityDelta: number,
): CartChange {
  return { productId: line.productId, volumeMl: line.volumeMl, quantityDelta };
}

/** Sets the quantity of the owner's line for this variant (`public_id`), up to its stock. */
export async function updateQuantity(
  owner: CartOwner,
  variantPublicId: string,
  quantity: number,
  db: Db = defaultDb,
): Promise<CartChangeResult> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return { ok: false, error: "not-in-cart" };
  }
  return db.transaction(async (tx) => {
    const line = (await lockCart(tx, cartId))
      ? await findCartLine(tx, cartId, variantPublicId)
      : undefined;
    if (!line) {
      return { ok: false, error: "not-in-cart" };
    }
    if (quantity > line.stockQuantity) {
      return { ok: false, error: "exceeds-stock", available: line.stockQuantity };
    }
    await tx.update(cartItems).set({ quantity }).where(eq(cartItems.id, line.id));
    await touchCart(tx, cartId);
    return { ok: true, change: changeOf(line, quantity - line.quantity) };
  });
}

/** Removes the owner's line for this variant (`public_id`). */
export async function removeItem(
  owner: CartOwner,
  variantPublicId: string,
  db: Db = defaultDb,
): Promise<CartChangeResult> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return { ok: false, error: "not-in-cart" };
  }
  return db.transaction(async (tx) => {
    const line = (await lockCart(tx, cartId))
      ? await findCartLine(tx, cartId, variantPublicId)
      : undefined;
    if (!line) {
      return { ok: false, error: "not-in-cart" };
    }
    await tx.delete(cartItems).where(eq(cartItems.id, line.id));
    await touchCart(tx, cartId);
    return { ok: true, change: changeOf(line, -line.quantity) };
  });
}

/**
 * Moves the guest's active cart to the user after login or registration. Without a user cart the
 * guest cart is adopted; otherwise its lines are added to the user's (same size: quantities add
 * up, capped at stock; sold-out sizes are dropped) and the emptied guest cart is deleted.
 */
export async function mergeGuestCart(
  userId: number,
  anonymousId: string,
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const guestCartId = await findActiveGuestCartId(tx, anonymousId);
    if (guestCartId === undefined) {
      return;
    }
    const userCartId = await findActiveUserCartId(tx, userId);
    // A user cart abandoned since the lookup counts as none.
    if (userCartId === undefined || !(await lockCart(tx, userCartId))) {
      if (await lockCart(tx, guestCartId)) {
        await tx.update(carts).set({ userId }).where(eq(carts.id, guestCartId));
      }
      return;
    }
    if (!(await lockCart(tx, guestCartId))) {
      return;
    }
    for (const line of await listCartItemsWithStock(tx, guestCartId)) {
      if (line.stockQuantity <= 0) continue;
      await tx
        .insert(cartItems)
        .values({
          cartId: userCartId,
          productId: line.productId,
          variantId: line.variantId,
          quantity: Math.min(line.quantity, line.stockQuantity),
        })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          // Never lower what the user already had, even if stock dropped below it.
          set: {
            quantity: sql`greatest(least(${cartItems.quantity} + excluded.quantity, ${line.stockQuantity}), ${cartItems.quantity})`,
          },
        });
    }
    // The guest's promo code comes along unless the user's cart has its own.
    const guestDiscountId = await findCartDiscountId(tx, guestCartId);
    if (guestDiscountId !== null && (await findCartDiscountId(tx, userCartId)) === null) {
      await setCartDiscount(tx, userCartId, guestDiscountId);
    }
    await tx.delete(carts).where(eq(carts.id, guestCartId));
    await touchCart(tx, userCartId);
  });
}
