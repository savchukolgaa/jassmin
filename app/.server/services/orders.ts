// Checkout orders (#11). `createOrder` turns the active cart into an order in one transaction:
// lock the cart row (as every cart change does), then the cart's variant rows in id order, check
// stock, insert the order and its lines, take the units off stock and mark the cart `converted`.
// Nothing is written before the stock check passes, and any error rolls everything back.
//
// `orders.cart_id` is unique, so a cart becomes at most one order: a second submit of the same
// cart waits for the first one's lock and then gets the order it created.
//
// The order's confirmation email (#45) is queued in the same transaction (`order_emails`), so an
// order never exists without it and a rolled-back order sends nothing. The caller records the
// `purchase` event (#18) and makes the first delivery attempt for an order this call `placed`,
// after the transaction committed.
import type { CheckoutInput, CheckoutPrefill, OrderConfirmation } from "~/lib/checkout";
import { formatShippingAddress } from "~/lib/checkout";
import type { Locale } from "~/lib/i18n";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { cartTotals, lockCart } from "../db/queries/cart";
import { insertOrderEmail } from "../db/queries/order-emails";
import {
  decrementVariantStock,
  findCartStatus,
  findOrder,
  findOrderIdByCartId,
  insertOrder,
  insertOrderItems,
  listOrderLines,
  lockCartLinesForOrder,
  markCartConverted,
} from "../db/queries/orders";
import { findUserContact } from "../db/queries/users";

/** A logged-in user's contact details for the checkout form, or `null`. */
export async function getCheckoutPrefill(
  userId: number,
  db: Db = defaultDb,
): Promise<CheckoutPrefill | null> {
  return (await findUserContact(db, userId)) ?? null;
}

export interface CreateOrderInput {
  /** The owner's active cart (`getActiveCartId`). */
  cartId: number;
  /** `null` for guests. */
  userId: number | null;
  customer: CheckoutInput;
  /** The language the shopper checked out in, for the confirmation email. */
  locale: Locale;
}

/** A line that asks for more than is in stock now; `variantId` is the variant's `public_id`. */
export interface ShortLine {
  variantId: string;
  available: number;
}

export type CreateOrderResult =
  // `placed: false` for a double submit that got the order an earlier request placed.
  | { ok: true; orderId: number; placed: true; subtotal: string }
  | { ok: true; orderId: number; placed: false }
  | { ok: false; error: "cart-empty" }
  | { ok: false; error: "insufficient-stock"; lines: ShortLine[] };

/** Places the order for the cart's lines at the variants' current prices. */
export async function createOrder(
  { cartId, userId, customer, locale }: CreateOrderInput,
  db: Db = defaultDb,
): Promise<CreateOrderResult> {
  return db.transaction(async (tx): Promise<CreateOrderResult> => {
    await lockCart(tx, cartId);
    const status = await findCartStatus(tx, cartId);
    if (status === "converted") {
      // A double submit: the first request already placed the order.
      const orderId = await findOrderIdByCartId(tx, cartId);
      if (orderId !== undefined) return { ok: true, orderId, placed: false };
    }
    if (status !== "active") {
      return { ok: false, error: "cart-empty" };
    }

    const lines = await lockCartLinesForOrder(tx, cartId);
    if (lines.length === 0) {
      return { ok: false, error: "cart-empty" };
    }
    const short = lines
      .filter((line) => line.quantity > line.stockQuantity)
      .map((line) => ({ variantId: line.variantPublicId, available: line.stockQuantity }));
    if (short.length > 0) {
      return { ok: false, error: "insufficient-stock", lines: short };
    }

    // The variant rows are locked, so these prices are the ones the lines are sold at.
    const { subtotal } = await cartTotals(tx, cartId);
    const orderId = await insertOrder(tx, {
      cartId,
      userId,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      shippingAddress: formatShippingAddress(customer),
      paymentMethod: customer.paymentMethod,
      subtotal,
    });
    await insertOrderItems(tx, orderId, lines);
    await insertOrderEmail(tx, { orderId, type: "confirmation", locale });
    for (const line of lines) {
      await decrementVariantStock(tx, line.variantId, line.quantity);
    }
    await markCartConverted(tx, cartId);
    return { ok: true, orderId, placed: true, subtotal };
  });
}

/** Who is asking to see an order: the logged-in user and the orders placed in this browser. */
export interface OrderViewer {
  userId: number | null;
  /** From the cookie session (`SessionData.orderIds`). */
  orderIds: readonly number[];
}

/** A user sees their own orders; anyone sees the orders they placed in this browser session. */
export function canViewOrder(
  order: { id: number; userId: number | null },
  viewer: OrderViewer,
): boolean {
  return (
    (order.userId !== null && order.userId === viewer.userId) || viewer.orderIds.includes(order.id)
  );
}

/** The order for its success page, or `undefined` when it doesn't exist or isn't the viewer's. */
export async function getOrderConfirmation(
  orderId: number,
  viewer: OrderViewer,
  db: Db = defaultDb,
): Promise<OrderConfirmation | undefined> {
  const order = await findOrder(db, orderId);
  if (!order || !canViewOrder(order, viewer)) {
    return undefined;
  }
  const { userId: _userId, ...confirmation } = order;
  return { ...confirmation, lines: await listOrderLines(db, orderId) };
}
