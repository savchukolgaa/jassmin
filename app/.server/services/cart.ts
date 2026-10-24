// The visitor's active cart (#10): a guest's hangs off their analytics session, a user's off
// their `user_id`. Price and stock come from the chosen variant. Every change bumps
// `carts.updated_at`, which the abandoned-cart job (#19) relies on. The job may abandon a cart
// between a lookup and `lockCart`, so writes check the status the lock returns.
import { and, eq, sql } from "drizzle-orm";
import { type CartActionError, type CartView, EMPTY_CART } from "~/lib/cart";
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
import { findUserById } from "../db/queries/users";
import { cartItems, carts } from "../db/schema";
import { getUserId } from "../session";

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

/** The owner's cart lines and totals; empty when they have no cart. */
export async function getCartView(owner: CartOwner, db: Db = defaultDb): Promise<CartView> {
  const cartId = await getActiveCartId(owner, db);
  if (cartId === undefined) {
    return EMPTY_CART;
  }
  const [lines, totals] = await Promise.all([listCartLines(db, cartId), cartTotals(db, cartId)]);
  return { lines, ...totals };
}

/** Units in the owner's active cart, for the header badge. */
export async function getCartCount(owner: CartOwner, db: Db = defaultDb): Promise<number> {
  if (owner.userId === null && !owner.anonymousId) {
    return 0;
  }
  const cartId = await getActiveCartId(owner, db);
  return cartId === undefined ? 0 : (await cartTotals(db, cartId)).itemCount;
}

export type CartChangeResult =
  | { ok: true }
  | { ok: false; error: Extract<CartActionError, "exceeds-stock">; available: number }
  | { ok: false; error: Extract<CartActionError, "not-in-cart"> };

/** The variant to add, as returned by `checkVariantForCart`. */
export interface CartVariant {
  id: number;
  productId: number;
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
    return { ok: true };
  });
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
    return { ok: true };
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
    return { ok: true };
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
    await tx.delete(carts).where(eq(carts.id, guestCartId));
    await touchCart(tx, userCartId);
  });
}
