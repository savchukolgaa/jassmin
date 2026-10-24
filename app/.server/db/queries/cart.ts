import { and, asc, desc, eq, exists, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { cartItems, carts, products, productVariants, sessions } from "../schema";

/** A `Db` or a transaction, so the cart service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

const isActive = eq(carts.status, "active");

/** The id of the user's active cart. */
export async function findActiveUserCartId(
  db: Executor,
  userId: number,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(and(isActive, eq(carts.userId, userId)))
    .limit(1);
  return row?.id;
}

/**
 * The id of the guest's active cart: one without a user, tied to any of the visitor's analytics
 * sessions, so the cart survives a new session.
 */
export async function findActiveGuestCartId(
  db: Executor,
  anonymousId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: carts.id })
    .from(carts)
    .innerJoin(sessions, eq(sessions.sessionId, carts.sessionId))
    .where(and(isActive, isNull(carts.userId), eq(sessions.anonymousId, anonymousId)))
    .orderBy(desc(carts.updatedAt), desc(carts.id))
    .limit(1);
  return row?.id;
}

/**
 * Creates an active cart. `undefined` when the owner already has one (the partial unique indexes
 * on `carts`), e.g. after a concurrent add.
 */
export async function insertActiveCart(
  db: Executor,
  values: { userId: number | null; sessionId: string },
): Promise<number | undefined> {
  const [row] = await db
    .insert(carts)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: carts.id });
  return row?.id;
}

/**
 * Locks the cart row until the transaction ends, so changes to one cart run one at a time.
 * Returns whether the cart is still active: the abandoned-cart job (#19) may have marked it
 * between the caller's lookup and the lock.
 */
export async function lockCart(db: Executor, cartId: number): Promise<boolean> {
  const [row] = await db
    .select({ status: carts.status })
    .from(carts)
    .where(eq(carts.id, cartId))
    .for("update");
  return row?.status === "active";
}

/** Bumps `updated_at`; every change to a cart's lines must call it (abandoned carts, #19). */
export async function touchCart(db: Executor, cartId: number): Promise<void> {
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/**
 * Marks active carts with lines and no activity for more than `hours` as `abandoned` (#19), and
 * returns how many it changed. Empty and finished carts are left alone, so it's safe to rerun.
 */
export async function markAbandonedCarts(db: Executor, hours: number): Promise<number> {
  const rows = await db
    .update(carts)
    .set({
      status: "abandoned",
      abandonedAt: sql`now()`,
      // Overrides `$onUpdate`: `updated_at` stays the shopper's last activity.
      updatedAt: sql`${carts.updatedAt}`,
    })
    .where(
      and(
        isActive,
        lt(carts.updatedAt, sql`now() - make_interval(hours => ${hours})`),
        exists(db.select({ one: sql`1` }).from(cartItems).where(eq(cartItems.cartId, carts.id))),
      ),
    )
    .returning({ id: carts.id });
  return rows.length;
}

/** The cart's lines with their product and size, oldest first. */
export function listCartLines(db: Executor, cartId: number) {
  return db
    .select({
      variantId: productVariants.publicId,
      productId: products.publicId,
      title: products.title,
      brand: products.brand,
      imageUrl: products.imageUrl,
      packSize: products.packSize,
      volumeMl: productVariants.volumeMl,
      unitPrice: productVariants.price,
      quantity: cartItems.quantity,
      stockQuantity: productVariants.stockQuantity,
      lineTotal: sql<string>`(${productVariants.price} * ${cartItems.quantity})::numeric(10, 2)`,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.addedAt), asc(cartItems.id));
}

/** Units and subtotal of the cart, computed as exact decimals. */
export async function cartTotals(
  db: Executor,
  cartId: number,
): Promise<{ itemCount: number; subtotal: string }> {
  const [row] = await db
    .select({
      itemCount: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int`,
      subtotal: sql<string>`coalesce(sum(${productVariants.price} * ${cartItems.quantity}), 0)::numeric(10, 2)`,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(eq(cartItems.cartId, cartId));
  return row ?? { itemCount: 0, subtotal: "0.00" };
}

/** The cart's line for this variant (`public_id`), with the variant's stock. */
export async function findCartLine(db: Executor, cartId: number, variantPublicId: string) {
  const [row] = await db
    .select({
      id: cartItems.id,
      quantity: cartItems.quantity,
      stockQuantity: productVariants.stockQuantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(and(eq(cartItems.cartId, cartId), eq(productVariants.publicId, variantPublicId)))
    .limit(1);
  return row;
}

/** The cart's lines with the variant's stock, for merging carts. */
export function listCartItemsWithStock(db: Executor, cartId: number) {
  return db
    .select({
      productId: cartItems.productId,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      stockQuantity: productVariants.stockQuantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(eq(cartItems.cartId, cartId));
}
