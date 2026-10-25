import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AccountOrderLine } from "~/lib/account";
import {
  DISCOUNT_AMOUNT,
  FREE_SHIPPING_THRESHOLD,
  type OrderConfirmation,
  type OrderSummaryLine,
  SHIPPING_AMOUNT,
} from "~/lib/checkout";
import type { CartStatus, PaymentMethod } from "~/lib/enums";
import type { OrderLifecyclePatch } from "~/lib/order-status";
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

/**
 * The order as its confirmation shows it, without checking who asks: for the confirmation email
 * (#45), which goes to the order's own address. `undefined` when it doesn't exist.
 */
export async function findOrderConfirmation(
  db: Executor,
  orderId: number,
): Promise<OrderConfirmation | undefined> {
  const order = await findOrder(db, orderId);
  if (!order) {
    return undefined;
  }
  const { userId: _userId, ...confirmation } = order;
  return { ...confirmation, lines: await listOrderLines(db, orderId) };
}

// Account dashboard (#12). Every query filters by `user_id`, so a user only ever loads their own
// orders; guest orders with the same email aren't linked.

/** The user's orders, newest first, with the number of units bought. */
export function listUserOrders(db: Executor, userId: number) {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      cancelledAt: orders.cancelledAt,
      refundedAt: orders.refundedAt,
      totalAmount: orders.totalAmount,
      itemCount: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(eq(orders.userId, userId))
    .groupBy(orders.id)
    .orderBy(desc(orders.createdAt), desc(orders.id));
}

/** The user's order with its delivery details, or `undefined` when it isn't theirs. */
export async function findUserOrder(db: Executor, userId: number, orderId: number) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      cancelledAt: orders.cancelledAt,
      refundedAt: orders.refundedAt,
      totalAmount: orders.totalAmount,
      subtotal: orders.subtotal,
      freeShipping: orders.freeShipping,
      fullName: orders.guestFullName,
      phone: orders.guestPhone,
      shippingAddress: orders.shippingAddress,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  return row;
}

/**
 * The lines of these orders in the order they were bought, at `price_at_purchase`. The caller
 * makes sure the orders are the viewer's. The product may have been deleted since.
 */
export async function listOrderLinesByOrderIds(
  db: Executor,
  orderIds: readonly number[],
): Promise<(AccountOrderLine & { orderId: number })[]> {
  if (orderIds.length === 0) return [];
  const rows = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      title: products.title,
      brand: products.brand,
      imageUrl: products.imageUrl,
      volumeMl: orderItems.volumeMl,
      packSize: products.packSize,
      quantity: orderItems.quantity,
      unitPrice: orderItems.priceAtPurchase,
      lineTotal: sql<string>`(${orderItems.priceAtPurchase} * ${orderItems.quantity})::numeric(10, 2)`,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(inArray(orderItems.orderId, [...orderIds]))
    .orderBy(asc(orderItems.id));
  return rows.map(({ id, ...line }) => ({ key: String(id), ...line }));
}

// Status changes from the Strapi admin (#40), applied by `services/cms-sync.ts` in one
// transaction, and the order as Strapi shows it.

/** The order's lifecycle columns, locking its row until the transaction ends. */
export async function lockOrderLifecycle(db: Executor, orderId: number) {
  const [row] = await db
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      paidAt: orders.paidAt,
      cancelledAt: orders.cancelledAt,
      refundedAt: orders.refundedAt,
      shippedAt: orders.shippedAt,
      completedAt: orders.completedAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update");
  return row;
}

/** Writes the status, payment status and timestamps; `$onUpdate` bumps `updated_at`. */
export async function updateOrderLifecycle(
  db: Executor,
  orderId: number,
  patch: OrderLifecyclePatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(orders).set(patch).where(eq(orders.id, orderId));
}

/**
 * Puts the order's units back on their sizes' stock, locking those rows in id order like
 * checkout does. Lines whose size was deleted are skipped. Returns the touched products' ids.
 */
export async function restockOrder(db: Executor, orderId: number): Promise<number[]> {
  const lines = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(productVariants.id))
    .for("update", { of: productVariants });
  for (const line of lines) {
    await db
      .update(productVariants)
      .set({ stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}` })
      .where(eq(productVariants.id, line.variantId));
  }
  return [...new Set(lines.map((line) => line.productId))];
}

/** Everything Strapi shows about an order, with its lines in the order they were bought. */
export async function findOrderSyncState(db: Executor, orderId: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return undefined;
  const items = await db
    .select({
      productPublicId: products.publicId,
      productName: products.title,
      brand: products.brand,
      volumeMl: orderItems.volumeMl,
      quantity: orderItems.quantity,
      unitPrice: orderItems.priceAtPurchase,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));
  return { order, items };
}

export type OrderSyncRow = NonNullable<Awaited<ReturnType<typeof findOrderSyncState>>>;
