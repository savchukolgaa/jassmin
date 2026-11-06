import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AccountOrderLine } from "~/lib/account";
import {
  FREE_SHIPPING_THRESHOLD,
  type OrderConfirmation,
  type OrderStatusEmail,
  type OrderSummaryLine,
  SHIPPING_AMOUNT,
} from "~/lib/checkout";
import type { DiscountLine } from "~/lib/discounts";
import type { CartStatus, PaymentMethod } from "~/lib/enums";
import type { OrderLifecyclePatch } from "~/lib/order-status";
import type { Db } from "../client";
import {
  cartItems,
  carts,
  discounts,
  orderItems,
  orders,
  payments,
  products,
  productVariants,
} from "../schema";
import { availableStock } from "./products";

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
      // For product- and pack-scoped discount rules (#59).
      productPublicId: products.publicId,
      packSize: products.packSize,
      volumeMl: productVariants.volumeMl,
      price: productVariants.price,
      // 0 for an archived product (#40), so checkout answers `insufficient-stock` for its lines;
      // `UNTRACKED_STOCK` for a size that doesn't count stock (#98).
      stockQuantity: availableStock,
      trackStock: productVariants.trackStock,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
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
  /** What the applied discount takes off (#59), `"0.00"` without one. */
  discountAmount: string;
  /** The applied rule, or `null`. */
  discountId: number | null;
  /** What a gift card pays (#125), `"0.00"` without one. */
  giftCardAmount: string;
  /**
   * When it's placed (`created_at`, and `paid_at` of an order a gift card paid in full), so its
   * first status history row has the same time (#128). Defaults to now.
   */
  placedAt?: Date;
}

/**
 * Inserts the order. The total and `free_shipping` are computed by PostgreSQL as `numeric`, from
 * the subtotal, the discount and the shipping and free-shipping constants; the total is what is
 * left to pay after the gift card (#125), which never changes free shipping. An order a gift card
 * paid in full (`gift_card`) is placed already paid.
 */
export async function insertOrder(db: Executor, order: NewOrder): Promise<number> {
  const subtotal = sql`${order.subtotal}::numeric`;
  const discount = sql`${order.discountAmount}::numeric`;
  const giftCard = sql`${order.giftCardAmount}::numeric`;
  const placedAt = order.placedAt ?? new Date();
  const paid =
    order.paymentMethod === "gift_card"
      ? { status: "paid" as const, paymentStatus: "paid" as const, paidAt: placedAt }
      : {};
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
      discountAmount: order.discountAmount,
      discountId: order.discountId,
      shippingAmount: SHIPPING_AMOUNT,
      giftCardAmount: order.giftCardAmount,
      totalAmount: sql`(${subtotal} - ${discount} + ${SHIPPING_AMOUNT}::numeric - ${giftCard})::numeric(10, 2)`,
      freeShipping: sql`(${subtotal} - ${discount}) >= ${FREE_SHIPPING_THRESHOLD}::numeric`,
      createdAt: placedAt,
      ...paid,
    })
    .returning({ id: orders.id });
  if (!row) {
    throw new Error("Could not insert the order");
  }
  return row.id;
}

/**
 * Inserts the order's lines with the variant's price at purchase, a size snapshot and the line's
 * share of the discount (#128; `"0.00"` when it has none).
 */
export async function insertOrderItems(
  db: Executor,
  orderId: number,
  lines: {
    productId: number;
    variantId: number;
    volumeMl: number;
    quantity: number;
    price: string;
    discountAllocated: string;
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
      discountAllocated: line.discountAllocated,
    })),
  );
}

/**
 * Takes the bought units off the variant's stock (the CHECK keeps it from going negative). A size
 * that doesn't track stock (#98) is left alone.
 */
export async function decrementVariantStock(
  db: Executor,
  variantId: number,
  quantity: number,
): Promise<void> {
  await db
    .update(productVariants)
    .set({ stockQuantity: sql`${productVariants.stockQuantity} - ${quantity}` })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.trackStock, true)));
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

/** The order's discount columns, joined from `discounts` (#59). */
const discountColumns = {
  discountAmount: orders.discountAmount,
  discountId: orders.discountId,
  discountCode: discounts.code,
  discountKind: discounts.kind,
};

/** The applied discount as summaries show it, from `discountColumns`. */
function toDiscount({
  discountAmount,
  discountId,
  discountCode,
  discountKind,
}: {
  discountAmount: string;
  discountId: number | null;
  discountCode: string | null;
  discountKind: DiscountLine["kind"] | null;
}): DiscountLine | null {
  return discountId === null || discountKind === null
    ? null
    : { amount: discountAmount, code: discountCode, kind: discountKind };
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
      ...discountColumns,
      shippingAmount: orders.shippingAmount,
      giftCardAmount: orders.giftCardAmount,
      totalAmount: orders.totalAmount,
    })
    .from(orders)
    .leftJoin(discounts, eq(discounts.id, orders.discountId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) return undefined;
  const { discountId, discountCode, discountKind, ...order } = row;
  return {
    ...order,
    discount: toDiscount({
      discountAmount: row.discountAmount,
      discountId,
      discountCode,
      discountKind,
    }),
  };
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

/**
 * The order as its status emails (#138) show it: the confirmation plus its current status,
 * payment status and waybill. Like the confirmation, it goes to the order's own address.
 */
export async function findOrderStatusEmail(
  db: Executor,
  orderId: number,
): Promise<OrderStatusEmail | undefined> {
  const order = await findOrder(db, orderId);
  if (!order) {
    return undefined;
  }
  const [state] = await db
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      waybillNumber: orders.waybillNumber,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!state) {
    return undefined;
  }
  return { ...order, ...state, lines: await listOrderLines(db, orderId) };
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
      shippedAt: orders.shippedAt,
      completedAt: orders.completedAt,
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
      shippedAt: orders.shippedAt,
      completedAt: orders.completedAt,
      totalAmount: orders.totalAmount,
      subtotal: orders.subtotal,
      ...discountColumns,
      giftCardAmount: orders.giftCardAmount,
      freeShipping: orders.freeShipping,
      fullName: orders.guestFullName,
      phone: orders.guestPhone,
      shippingAddress: orders.shippingAddress,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .leftJoin(discounts, eq(discounts.id, orders.discountId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!row) return undefined;
  const { discountAmount, discountId, discountCode, discountKind, ...order } = row;
  return {
    ...order,
    discount: toDiscount({ discountAmount, discountId, discountCode, discountKind }),
  };
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
      productId: products.publicId,
      title: products.title,
      brand: products.brand,
      fragranceFamily: products.fragranceFamily,
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
      returnedAt: orders.returnedAt,
      cancelReason: orders.cancelReason,
      arrivedAt: orders.arrivedAt,
      waybillNumber: orders.waybillNumber,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update");
  return row;
}

/** When a card order counts as abandoned unpaid (#128). */
export interface UnpaidCardOrderCutoffs {
  /** Placed before this. */
  placedBefore: Date;
  /** And no payment attempt started at or after this (the shopper may still be paying). */
  noAttemptSince: Date;
}

/**
 * Card orders still `pending` / `unpaid` that were placed before `placedBefore` and have had no
 * payment attempt since `noAttemptSince`, oldest first; `orderId` limits it to that one order (to
 * check again under its lock). The unpaid-order job cancels them.
 */
export async function listUnpaidCardOrderIds(
  db: Executor,
  { placedBefore, noAttemptSince }: UnpaidCardOrderCutoffs,
  orderId?: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        orderId === undefined ? undefined : eq(orders.id, orderId),
        eq(orders.paymentMethod, "card"),
        eq(orders.status, "pending"),
        eq(orders.paymentStatus, "unpaid"),
        sql`${orders.createdAt} < ${placedBefore}`,
        sql`not exists (
          select 1 from ${payments}
          where ${payments.orderId} = ${orders.id} and ${payments.createdAt} >= ${noAttemptSince}
        )`,
      ),
    )
    .orderBy(asc(orders.id));
  return rows.map((row) => row.id);
}

/**
 * Writes the status, payment status, timestamps and waybill number; `$onUpdate` bumps
 * `updated_at`.
 */
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
 * checkout does. Lines whose size was deleted, or doesn't track stock (#98), are skipped.
 * Returns the touched products' ids.
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
    .where(and(eq(orderItems.orderId, orderId), eq(productVariants.trackStock, true)))
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
