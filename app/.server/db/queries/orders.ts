import { and, asc, eq, sql } from "drizzle-orm";
import {
  DISCOUNT_AMOUNT,
  FREE_SHIPPING_THRESHOLD,
  type OrderSummaryLine,
  SHIPPING_AMOUNT,
} from "~/lib/checkout";
import type { CartStatus, PaymentMethod } from "~/lib/enums";
import type { Db } from "../client";
import { cartItems, carts, orderItems, orders, products, productVariants } from "../schema";

/** A `Db` or a transaction, so the order service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

/** The cart's status, or `undefined` when the cart doesn't exist. */
export async function findCartStatus(
  db: Executor,
  cartId: number,
): Promise<CartStatus | undefined> {
  const [row] = await db
    .select({ status: carts.status })
    .from(carts)
    .where(eq(carts.id, cartId))
    .limit(1);
  return row?.status;
}

/**
 * The cart's lines with their variant's price and stock, locking those variant rows until the
 * transaction ends. Rows are locked in variant id order, so two checkouts sharing sizes can't
 * deadlock, and each sees the stock the other committed.
 */
export function lockCartLinesForOrder(db: Executor, cartId: number) {
  return db
    .select({
      variantId: productVariants.id,
      variantPublicId: productVariants.publicId,
      productId: productVariants.productId,
      volumeMl: productVariants.volumeMl,
      price: productVariants.price,
      stockQuantity: productVariants.stockQuantity,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(productVariants.id))
    .for("update", { of: productVariants });
}

export interface NewOrder {
  cartId: number;
  userId: number | null;
  fullName: string;
  email: string;
  phone: string;
  shippingAddress: string;
  paymentMethod: PaymentMethod;
  /** The lines' sum as an exact decimal string, from `cartTotals`. */
  subtotal: string;
}

/**
 * Inserts the order. The total and `free_shipping` are computed by PostgreSQL as `numeric`, from
 * the subtotal and the discount, shipping and free-shipping constants.
 */
export async function insertOrder(db: Executor, order: NewOrder): Promise<number> {
  const subtotal = sql`${order.subtotal}::numeric`;
  const discount = sql`${DISCOUNT_AMOUNT}::numeric`;
  const [row] = await db
    .insert(orders)
    .values({
      cartId: order.cartId,
      userId: order.userId,
      guestFullName: order.fullName,
      guestEmail: order.email,
      guestPhone: order.phone,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotal,
      discountAmount: DISCOUNT_AMOUNT,
      shippingAmount: SHIPPING_AMOUNT,
      totalAmount: sql`(${subtotal} - ${discount} + ${SHIPPING_AMOUNT}::numeric)::numeric(10, 2)`,
      freeShipping: sql`(${subtotal} - ${discount}) >= ${FREE_SHIPPING_THRESHOLD}::numeric`,
    })
    .returning({ id: orders.id });
  if (!row) {
    throw new Error("Could not insert the order");
  }
  return row.id;
}

/** Inserts the order's lines with the variant's price at purchase and a size snapshot. */
export async function insertOrderItems(
  db: Executor,
  orderId: number,
  lines: {
    productId: number;
    variantId: number;
    volumeMl: number;
    quantity: number;
    price: string;
  }[],
): Promise<void> {
  await db.insert(orderItems).values(
    lines.map((line) => ({
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      volumeMl: line.volumeMl,
      quantity: line.quantity,
      priceAtPurchase: line.price,
    })),
  );
}

/** Takes the bought units off the variant's stock (the CHECK keeps it from going negative). */
export async function decrementVariantStock(
  db: Executor,
  variantId: number,
  quantity: number,
): Promise<void> {
  await db
    .update(productVariants)
    .set({ stockQuantity: sql`${productVariants.stockQuantity} - ${quantity}` })
    .where(eq(productVariants.id, variantId));
}

/** Marks the cart `converted`; `$onUpdate` bumps its `updated_at`. */
export async function markCartConverted(db: Executor, cartId: number): Promise<void> {
  await db
    .update(carts)
    .set({ status: "converted" })
    .where(and(eq(carts.id, cartId), eq(carts.status, "active")));
}

/** The id of the order placed from this cart. */
export async function findOrderIdByCartId(
  db: Executor,
  cartId: number,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.cartId, cartId))
    .limit(1);
  return row?.id;
}

/** The order with its owner, for the confirmation page. */
export async function findOrder(db: Executor, orderId: number) {
  const [row] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      createdAt: orders.createdAt,
      fullName: orders.guestFullName,
      email: orders.guestEmail,
      phone: orders.guestPhone,
      shippingAddress: orders.shippingAddress,
      paymentMethod: orders.paymentMethod,
      freeShipping: orders.freeShipping,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      shippingAmount: orders.shippingAmount,
      totalAmount: orders.totalAmount,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row;
}

/** The order's lines in the order they were bought; the product may have been deleted since. */
export async function listOrderLines(db: Executor, orderId: number): Promise<OrderSummaryLine[]> {
  const rows = await db
    .select({
      id: orderItems.id,
      title: products.title,
      brand: products.brand,
      volumeMl: orderItems.volumeMl,
      packSize: products.packSize,
      quantity: orderItems.quantity,
      unitPrice: orderItems.priceAtPurchase,
      lineTotal: sql<string>`(${orderItems.priceAtPurchase} * ${orderItems.quantity})::numeric(10, 2)`,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));
  return rows.map(({ id, ...line }) => ({ key: String(id), ...line }));
}
