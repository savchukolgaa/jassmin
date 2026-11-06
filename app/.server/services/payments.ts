// Online card payment (#44). A card order is paid on the provider's hosted page; every visit there
// is a new attempt in `payments` with its own reference (`<order id>-<attempt>`). The provider's
// signed callback settles the attempt and, on success, the order.
//
// - The amount is always the order's stored `total_amount`, never anything from the request.
// - Gift cards (#125) are bought the same way: an attempt for the card's stored amount, with the
//   reference `G<gift card id>-<attempt>`. A successful callback activates the card and queues
//   its code emails; a failed one leaves it `pending`.
// - The callback is idempotent: it locks the attempt row, ignores attempts that already
//   succeeded, and marks the order paid only while it is `pending` and `unpaid`
//   (`markOrderPaid`), so a repeated callback never changes the order twice. That change is
//   recorded in `order_status_history` (`payment`, #128) in the same transaction.
// - A failed attempt leaves the order `unpaid`; the shopper can start another one.
//
// The provider and the database are injectable for tests.
import type { PaymentView } from "~/lib/checkout";
import type { GiftCardPaymentView } from "~/lib/gift-cards";
import type { Locale } from "~/lib/i18n";
import { createTranslator } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { enqueueCmsSync } from "../db/queries/cms-outbox";
import { activateGiftCard, findGiftCard } from "../db/queries/gift-cards";
import { insertOrderEmail } from "../db/queries/order-emails";
import { insertOrderStatusHistory } from "../db/queries/order-status-history";
import {
  countPayments,
  findLatestPaymentStatus,
  findPayableOrder,
  insertPayment,
  lockPaymentByReference,
  markOrderPaid,
  markPayment,
} from "../db/queries/payments";
import { getEnv } from "../env";
import type { ParsedCallback, PaymentProvider } from "../payments/provider";
import { getPaymentProvider } from "../payments/provider";
import { canViewGiftCard, type GiftCardViewer } from "./gift-cards";
import { canViewOrder, type OrderViewer } from "./orders";

export interface PaymentDeps {
  db: Db;
  /** `null` when `PAYMENT_PROVIDER` isn't set. */
  provider: PaymentProvider | null;
}

function defaultDeps(): PaymentDeps {
  return { db: defaultDb, provider: getPaymentProvider(getEnv()) };
}

/** Whether checkout can offer card payment: a provider is configured. */
export function isCardPaymentAvailable(): boolean {
  return getPaymentProvider(getEnv()) !== null;
}

/** Only a card order that is still `pending` and `unpaid` can start a payment attempt. */
export function isPayable(order: {
  paymentMethod: string;
  paymentStatus: string;
  status: string;
}): boolean {
  return (
    order.paymentMethod === "card" && order.paymentStatus === "unpaid" && order.status === "pending"
  );
}

export interface StartPaymentInput {
  orderId: number;
  /** The provider page's language. */
  locale: Locale;
  /** This site's origin, for the absolute return and callback URLs. */
  origin: string;
  /** When set, only an order this viewer may see can be paid; others are `not-found`. */
  viewer?: OrderViewer;
}

export type StartPaymentResult =
  | { ok: true; redirectUrl: string; reference: string }
  | { ok: false; error: "unavailable" | "not-found" | "not-payable" };

/** Starts a new attempt for the order's stored total and returns the provider page to go to. */
export async function startPayment(
  { orderId, locale, origin, viewer }: StartPaymentInput,
  { db, provider }: PaymentDeps = defaultDeps(),
): Promise<StartPaymentResult> {
  if (!provider) {
    return { ok: false, error: "unavailable" };
  }
  return db.transaction(async (tx): Promise<StartPaymentResult> => {
    // Locked, so two tabs retrying at once get attempts 2 and 3 instead of clashing on 2.
    const order = await findPayableOrder(tx, orderId, { lock: true });
    if (!order || (viewer && !canViewOrder(order, viewer))) {
      return { ok: false, error: "not-found" };
    }
    if (!isPayable(order)) {
      return { ok: false, error: "not-payable" };
    }
    const reference = `${orderId}-${(await countPayments(tx, { orderId })) + 1}`;
    await insertPayment(tx, {
      orderId,
      provider: provider.name,
      reference,
      amount: order.totalAmount,
      currency: order.currency,
    });
    const { redirectUrl } = provider.createCheckout({
      reference,
      amount: order.totalAmount,
      currency: order.currency,
      description: createTranslator(locale).t("payments.description", { id: orderId }),
      resultUrl: new URL(
        pathFor(locale, "checkoutSuccess", { orderId: String(orderId) }),
        origin,
      ).toString(),
      callbackUrl: new URL("/payments/callback", origin).toString(),
      locale,
    });
    return { ok: true, redirectUrl, reference };
  });
}

export interface StartGiftCardPaymentInput {
  giftCardId: number;
  /** The provider page's language. */
  locale: Locale;
  /** This site's origin, for the absolute return and callback URLs. */
  origin: string;
  /** When set, only a card this viewer bought can be paid; others are `not-found`. */
  viewer?: GiftCardViewer;
}

/**
 * Starts a new attempt for a `pending` gift card's stored amount (#125) and returns the provider
 * page to go to. A card that is paid already is `not-payable`.
 */
export async function startGiftCardPayment(
  { giftCardId, locale, origin, viewer }: StartGiftCardPaymentInput,
  { db, provider }: PaymentDeps = defaultDeps(),
): Promise<StartPaymentResult> {
  if (!provider) {
    return { ok: false, error: "unavailable" };
  }
  return db.transaction(async (tx): Promise<StartPaymentResult> => {
    // Locked, so two tabs retrying at once get different attempt numbers.
    const card = await findGiftCard(tx, giftCardId, { lock: true });
    if (!card || (viewer && !canViewGiftCard(card, viewer))) {
      return { ok: false, error: "not-found" };
    }
    if (card.status !== "pending") {
      return { ok: false, error: "not-payable" };
    }
    const reference = `G${giftCardId}-${(await countPayments(tx, { giftCardId })) + 1}`;
    await insertPayment(tx, {
      giftCardId,
      provider: provider.name,
      reference,
      amount: card.initialAmount,
      currency: card.currency,
    });
    const translator = createTranslator(locale);
    const { redirectUrl } = provider.createCheckout({
      reference,
      amount: card.initialAmount,
      currency: card.currency,
      description: translator.t("payments.giftCardDescription", {
        amount: translator.formatPrice(card.initialAmount),
      }),
      resultUrl: new URL(
        pathFor(locale, "giftCardSuccess", { giftCardId: String(giftCardId) }),
        origin,
      ).toString(),
      callbackUrl: new URL("/payments/callback", origin).toString(),
      locale,
    });
    return { ok: true, redirectUrl, reference };
  });
}

export type PaymentCallbackResult =
  | Exclude<ParsedCallback, { ok: true }>
  | { ok: false; error: "unavailable" }
  /** A gift card attempt that paid also says which card is now active, for its emails. */
  | { ok: true; result: "paid"; giftCardId?: number }
  /** `ignored`: unknown reference, a repeat, an amount mismatch or an order that can't be paid. */
  | { ok: true; result: "failed" | "pending" | "ignored" };

/** Verifies a provider callback and applies it to its attempt and order, idempotently. */
export async function handlePaymentCallback(
  form: FormData,
  { db, provider }: PaymentDeps = defaultDeps(),
): Promise<PaymentCallbackResult> {
  if (!provider) {
    return { ok: false, error: "unavailable" };
  }
  const parsed = provider.parseCallback(form);
  if (!parsed.ok) {
    return parsed;
  }
  const { event } = parsed;

  return db.transaction(async (tx): Promise<PaymentCallbackResult> => {
    const payment = await lockPaymentByReference(tx, event.reference);
    if (!payment || payment.provider !== provider.name) {
      console.warn(`Payment callback for an unknown reference ${event.reference}`);
      return { ok: true, result: "ignored" };
    }
    if (payment.status === "succeeded") {
      // A repeated callback: the order was settled by the first one.
      return { ok: true, result: "ignored" };
    }
    if (event.amount !== payment.amount || event.currency !== payment.currency) {
      console.error(
        `Payment ${payment.reference}: callback for ${event.amount} ${event.currency}, expected ${payment.amount} ${payment.currency}`,
      );
      return { ok: true, result: "ignored" };
    }

    const update = { providerPaymentId: event.providerPaymentId, lastCallback: event.raw };
    switch (event.outcome) {
      case "success": {
        await markPayment(tx, payment.id, { status: "succeeded", ...update });
        if (payment.giftCardId !== null) {
          const card = await activateGiftCard(tx, payment.giftCardId, {
            paymentId: payment.id,
            now: new Date(),
          });
          if (!card) {
            console.warn(
              `Payment ${payment.reference} succeeded, but gift card ${payment.giftCardId} is no longer awaiting payment`,
            );
            return { ok: true, result: "ignored" };
          }
          // The code goes to the buyer, and to the recipient they named; the callback route
          // sends them and pushes the card to Strapi after the commit.
          await insertOrderEmail(tx, {
            giftCardId: card.id,
            type: "gift_card",
            locale: card.locale,
          });
          if (card.recipientEmail) {
            await insertOrderEmail(tx, {
              giftCardId: card.id,
              type: "gift_card_recipient",
              locale: card.locale,
            });
          }
          await enqueueCmsSync(tx, "gift_card", [card.id]);
          return { ok: true, result: "paid", giftCardId: card.id };
        }
        const paidAt = new Date();
        if (payment.orderId !== null && (await markOrderPaid(tx, payment.orderId, paidAt))) {
          // The order's path (#128): `pending` → `paid`, at the time stored in `paid_at`.
          await insertOrderStatusHistory(tx, {
            orderId: payment.orderId,
            status: "paid",
            source: "payment",
            changedAt: paidAt,
          });
          // Strapi shows the order as paid (#40); the callback route pushes it after the commit.
          await enqueueCmsSync(tx, "order", [payment.orderId]);
          return { ok: true, result: "paid" };
        }
        // Paid already by another attempt, or cancelled meanwhile: the money needs a manual refund.
        console.warn(
          `Payment ${payment.reference} succeeded, but order ${payment.orderId} is no longer awaiting payment`,
        );
        return { ok: true, result: "ignored" };
      }
      case "failure": {
        if (payment.status === "failed") {
          return { ok: true, result: "ignored" };
        }
        await markPayment(tx, payment.id, { status: "failed", ...update });
        return { ok: true, result: "failed" };
      }
      case "pending": {
        if (payment.status !== "pending") {
          return { ok: true, result: "ignored" };
        }
        await markPayment(tx, payment.id, { status: "pending", ...update });
        return { ok: true, result: "pending" };
      }
    }
  });
}

/**
 * The card order's payment state for its success page, or `null` for cash-on-delivery orders and
 * unpaid orders that can no longer be paid (e.g. cancelled).
 */
export async function getPaymentView(
  orderId: number,
  db: Db = defaultDb,
): Promise<PaymentView | null> {
  const order = await findPayableOrder(db, orderId);
  if (order?.paymentMethod !== "card") {
    return null;
  }
  if (order.paymentStatus === "paid") {
    return "paid";
  }
  if (!isPayable(order)) {
    return null;
  }
  return (await findLatestPaymentStatus(db, { orderId })) === "failed" ? "failed" : "pending";
}

/** Where a gift card's purchase payment stands, for its result page (#125). */
export async function getGiftCardPaymentView(
  giftCardId: number,
  db: Db = defaultDb,
): Promise<GiftCardPaymentView> {
  const card = await findGiftCard(db, giftCardId);
  if (card && card.status !== "pending") {
    return "paid";
  }
  return (await findLatestPaymentStatus(db, { giftCardId })) === "failed" ? "failed" : "pending";
}
