// Checkout orders (#11). `createOrder` turns the active cart into an order in one transaction:
// lock the cart row (as every cart change does), then the cart's variant rows in id order, check
// stock, insert the order and its lines, take the units off stock and mark the cart `converted`.
// Nothing is written before the stock check passes, and any error rolls everything back.
//
// `orders.cart_id` is unique, so a cart becomes at most one order: a second submit of the same
// cart waits for the first one's lock and then gets the order it created.
//
// Discounts (#59): the lines are priced with `priceCart` on the locked variant prices, and the
// applied rule is redeemed with a conditional increment, which waits for a concurrent checkout
// using the same rule and fails once it's used up; the cart is then priced without it. An order
// whose total came out higher than the page showed (`expectedTotal`) isn't placed.
//
// Gift cards (#125) pay after the discount and delivery: the cart's card is locked after the cart
// and its variants (the same lock order as every checkout), checked again, and its amount taken
// in the same transaction, so two orders can never spend more than its balance. An order the card
// pays in full is placed `gift_card` and already paid.
//
// Order lifecycle (#128): each line stores its share of the discount (`priceCart`'s
// `allocation`, which adds up to the order's discount), the order's first status goes into
// `order_status_history` (`checkout`), and a logged-in buyer's `users.city` becomes this order's
// delivery city, all in the same transaction.
//
// The order's confirmation email (#45) is queued in the same transaction (`order_emails`), so an
// order never exists without it and a rolled-back order sends nothing. The caller records the
// `purchase` event (#18) and makes the first delivery attempt for an order this call `placed`,
// after the transaction committed. The order and its products' stock are queued for Strapi
// (#40) in the same transaction, and the caller pushes them after the commit (`pushToCms`).

import type { AccountOrderDetail, AccountOrderLine, AccountOrders } from "~/lib/account";
import { isCurrentOrder } from "~/lib/account";
import type { PurchaseItem } from "~/lib/analytics";
import type { CheckoutInput, CheckoutPrefill, OrderConfirmation } from "~/lib/checkout";
import { formatShippingAddress } from "~/lib/checkout";
import type { DiscountKind, PaymentMethod } from "~/lib/enums";
import type { Locale } from "~/lib/i18n";
import { fromKopiyky, toKopiyky } from "~/lib/money";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { cartTotals, lockCart } from "../db/queries/cart";
import { enqueueCmsSync } from "../db/queries/cms-outbox";
import {
  findCartDiscountId,
  listCandidateDiscounts,
  redeemDiscount,
} from "../db/queries/discounts";
import { findCartGiftCardId, findGiftCard, redeemGiftCard } from "../db/queries/gift-cards";
import { insertOrderEmail } from "../db/queries/order-emails";
import { insertOrderStatusHistory } from "../db/queries/order-status-history";
import {
  decrementVariantStock,
  findCartStatus,
  findOrder,
  findOrderIdByCartId,
  findUserOrder,
  hasEarlierOrder,
  insertOrder,
  insertOrderItems,
  listOrderLines,
  listOrderLinesByOrderIds,
  listUserOrders,
  lockCartLinesForOrder,
  markCartConverted,
} from "../db/queries/orders";
import { findUserContact, setUserCity } from "../db/queries/users";
import { getEnv } from "../env";
import { checkGiftCard, giftCardAmountFor } from "./gift-cards";
import { getMailer } from "./mailer";
import { deliverOrderEmails, type OrderEmailReport, orderEmailDeps } from "./order-email";
import { type PricedCart, type PricingLine, priceCart } from "./pricing";

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
  /** The total the checkout page showed; a higher total isn't placed (`total-changed`). */
  expectedTotal?: string;
  /** For tests: the time discount windows are checked against. */
  now?: Date;
}

/** A line that asks for more than is in stock now; `variantId` is the variant's `public_id`. */
export interface ShortLine {
  variantId: string;
  available: number;
}

/** A placed order's amounts, for the `purchase` event. */
export interface PlacedOrderTotals {
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  discountId: number | null;
  /** The applied promo code; `null` for an automatic rule or no discount. */
  discountCode: string | null;
  discountKind: DiscountKind | null;
  /** What a gift card paid (#125), `"0.00"` without one. */
  giftCardAmount: string;
  /** As placed: `gift_card` when the card paid the whole order, else the shopper's choice. */
  paymentMethod: PaymentMethod;
  /** The order's lines, for the `purchase` event (#129). */
  items: PurchaseItem[];
  /** No earlier order of the user, or with the same email (`hasEarlierOrder`). */
  isFirstOrder: boolean;
}

export type CreateOrderResult =
  // `placed: false` for a double submit that got the order an earlier request placed.
  | ({ ok: true; orderId: number; placed: true } & PlacedOrderTotals)
  | { ok: true; orderId: number; placed: false }
  | { ok: false; error: "cart-empty" }
  | { ok: false; error: "insufficient-stock"; lines: ShortLine[] }
  // The total is higher than the page showed, e.g. the promo code was used up meanwhile.
  | { ok: false; error: "total-changed" };

/** Places the order for the cart's lines at the variants' current prices. */
export async function createOrder(
  { cartId, userId, customer, locale, expectedTotal, now = new Date() }: CreateOrderInput,
  db: Db = defaultDb,
): Promise<CreateOrderResult> {
  return db
    .transaction(async (tx): Promise<CreateOrderResult> => {
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
      const priced = await priceAndRedeem(tx, cartId, lines, now);
      const giftCard = await lockCartGiftCard(tx, cartId, priced.total, now);
      const amountDue = priced.total - giftCard.amount;
      if (expectedTotal !== undefined && amountDue > toKopiyky(expectedTotal)) {
        // Thrown, not returned, so the redemption rolls back with the rest.
        throw new TotalChanged();
      }
      const discountAmount = fromKopiyky(priced.discount);
      const giftCardAmount = fromKopiyky(giftCard.amount);
      const paymentMethod: PaymentMethod =
        amountDue === 0 && giftCard.amount > 0 ? "gift_card" : customer.paymentMethod;
      const isFirstOrder = !(await hasEarlierOrder(tx, { userId, email: customer.email }));
      const orderId = await insertOrder(tx, {
        cartId,
        userId,
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        shippingAddress: formatShippingAddress(customer),
        paymentMethod,
        subtotal,
        discountAmount,
        discountId: priced.applied?.discountId ?? null,
        giftCardAmount,
        placedAt: now,
      });
      if (priced.allocation.reduce((sum, share) => sum + share, 0) !== priced.discount) {
        // Never expected: `priceCart` allocates the discount exactly. Thrown, so nothing is kept.
        throw new Error(`The discount of order ${orderId} doesn't add up over its lines`);
      }
      const items = lines.map((line, index) => ({
        ...line,
        discountAllocated: fromKopiyky(priced.allocation[index] ?? 0),
      }));
      await insertOrderItems(tx, orderId, items);
      // The status `insertOrder` placed it in: `paid` when a gift card paid it all (#128).
      await insertOrderStatusHistory(tx, {
        orderId,
        status: paymentMethod === "gift_card" ? "paid" : "pending",
        source: "checkout",
        changedAt: now,
      });
      if (userId !== null) {
        await setUserCity(tx, userId, customer.city);
      }
      if (giftCard.id !== null && giftCard.amount > 0) {
        await redeemGiftCard(tx, { giftCardId: giftCard.id, orderId, amount: giftCardAmount });
        // Strapi shows the card's lower balance (#40); pushed after the commit.
        await enqueueCmsSync(tx, "gift_card", [giftCard.id]);
      }
      await insertOrderEmail(tx, { orderId, type: "confirmation", locale });
      // Only sizes that track stock lose units, each logged as a `sale` (#130); the rest are
      // poured to order (#98).
      const tracked = lines.filter((line) => line.trackStock);
      for (const line of tracked) {
        await decrementVariantStock(tx, {
          variantId: line.variantId,
          quantity: line.quantity,
          orderId,
          now,
        });
      }
      await markCartConverted(tx, cartId);
      // Strapi shows the new order and the products' lower stock (#40); pushed after the commit.
      await enqueueCmsSync(tx, "order", [orderId]);
      await enqueueCmsSync(
        tx,
        "product",
        tracked.map((line) => line.productId),
      );
      return {
        ok: true,
        orderId,
        placed: true,
        subtotal,
        discountAmount,
        totalAmount: fromKopiyky(amountDue),
        discountId: priced.applied?.discountId ?? null,
        discountCode: priced.applied?.code ?? null,
        discountKind: priced.applied?.kind ?? null,
        giftCardAmount,
        paymentMethod,
        items: items.map((item) => ({
          variant_id: item.variantPublicId,
          quantity: item.quantity,
          unit_price: item.price,
          discount_allocated: item.discountAllocated,
        })),
        isFirstOrder,
      };
    })
    .catch((error: unknown) => {
      if (error instanceof TotalChanged) {
        return { ok: false, error: "total-changed" } as const;
      }
      throw error;
    });
}

class TotalChanged extends Error {}

/**
 * The cart's gift card, locked `FOR UPDATE`, and what it pays of an order costing `total` (whole
 * kopiyky): 0 without a card or when it can't pay `now` (it expired or was spent meanwhile, which
 * the `expectedTotal` check then reports). A concurrent order using the same card waits here and
 * then sees the lower balance.
 */
async function lockCartGiftCard(
  tx: Pick<Db, "select" | "insert" | "update">,
  cartId: number,
  total: number,
  now: Date,
): Promise<{ id: number | null; amount: number }> {
  const giftCardId = await findCartGiftCardId(tx, cartId);
  if (giftCardId === null) {
    return { id: null, amount: 0 };
  }
  const card = await findGiftCard(tx, giftCardId, { lock: true });
  if (!card || checkGiftCard(card, now) !== null) {
    return { id: giftCardId, amount: 0 };
  }
  return { id: giftCardId, amount: giftCardAmountFor(total, toKopiyky(card.balance)) };
}

/**
 * Prices the locked lines with the best rule and counts it as redeemed. A rule a concurrent
 * order used up since it was read is dropped and the cart priced again.
 */
async function priceAndRedeem(
  tx: Pick<Db, "select" | "insert" | "update" | "delete">,
  cartId: number,
  lines: {
    productPublicId: string;
    volumeMl: number;
    packSize: number;
    price: string;
    quantity: number;
  }[],
  now: Date,
): Promise<PricedCart> {
  const pricingLines: PricingLine[] = lines.map((line) => ({
    productPublicId: line.productPublicId,
    volumeMl: line.volumeMl,
    packSize: line.packSize,
    unitPrice: toKopiyky(line.price),
    quantity: line.quantity,
  }));
  let candidates = await listCandidateDiscounts(tx, await findCartDiscountId(tx, cartId));
  let priced = priceCart(pricingLines, candidates, now);
  while (priced.applied !== null && !(await redeemDiscount(tx, priced.applied.discountId))) {
    const usedUp = priced.applied.discountId;
    candidates = candidates.filter((discount) => discount.id !== usedUp);
    priced = priceCart(pricingLines, candidates, now);
  }
  return priced;
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

/**
 * The first attempt at sending a placed order's confirmation, right after its transaction
 * committed (#45). Never rejects; `pnpm db:send-order-emails` retries a failure.
 */
export function deliverOrderConfirmation(
  orderId: number,
  db: Db = defaultDb,
): Promise<OrderEmailReport> {
  return deliverOrderEmails({ orderId }, () => orderEmailDeps(db, getMailer(), getEnv()));
}

/**
 * Sends an order's due emails (the status emails a Strapi change queued, #138) right after the
 * commit. Never rejects; `pnpm db:send-order-emails` retries what fails.
 */
export function deliverOrderStatusEmails(
  orderId: number,
  db: Db = defaultDb,
): Promise<OrderEmailReport> {
  return deliverOrderEmails({ orderId }, () => orderEmailDeps(db, getMailer(), getEnv()));
}

/** The user's orders for the account dashboard (#12), split into current and previous. */
export async function getAccountOrders(userId: number, db: Db = defaultDb): Promise<AccountOrders> {
  const orders = await listUserOrders(db, userId);
  const lines = await listOrderLinesByOrderIds(
    db,
    orders.map((order) => order.id),
  );
  const linesByOrder = new Map<number, AccountOrderLine[]>();
  for (const { orderId, ...line } of lines) {
    const list = linesByOrder.get(orderId);
    if (list) list.push(line);
    else linesByOrder.set(orderId, [line]);
  }

  const result: AccountOrders = { current: [], previous: [] };
  for (const order of orders) {
    const withLines = { ...order, lines: linesByOrder.get(order.id) ?? [] };
    (isCurrentOrder(order.status) ? result.current : result.previous).push(withLines);
  }
  return result;
}

/** The user's order for its account page, or `undefined` when it doesn't exist or isn't theirs. */
export async function getAccountOrder(
  userId: number,
  orderId: number,
  db: Db = defaultDb,
): Promise<AccountOrderDetail | undefined> {
  const order = await findUserOrder(db, userId, orderId);
  if (!order) return undefined;
  const lines = (await listOrderLinesByOrderIds(db, [orderId])).map(
    ({ orderId: _orderId, ...line }) => line,
  );
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { ...order, itemCount, lines };
}
