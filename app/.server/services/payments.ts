// Online card payment (#44). A card order is paid on the provider's hosted page; every visit there
// is a new attempt in `payments` with its own reference (`<order id>-<attempt>`). The provider's
// signed callback settles the attempt and, on success, the order.
//
// - The amount is always the order's stored `total_amount`, never anything from the request.
// - The callback is idempotent: it locks the attempt row, ignores attempts that already
//   succeeded, and marks the order paid only while it is `pending` and `unpaid`
//   (`markOrderPaid`), so a repeated callback never changes the order twice.
// - A failed attempt leaves the order `unpaid`; the shopper can start another one.
//
// The provider and the database are injectable for tests.
import type { PaymentView } from "~/lib/checkout";
import type { Locale } from "~/lib/i18n";
import { createTranslator } from "~/lib/i18n";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
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
}

export type StartPaymentResult =
  | { ok: true; redirectUrl: string; reference: string }
  | { ok: false; error: "unavailable" | "not-payable" };

/** Starts a new attempt for the order's stored total and returns the provider page to go to. */
export async function startPayment(
  { orderId, locale, origin }: StartPaymentInput,
  { db, provider }: PaymentDeps = defaultDeps(),
): Promise<StartPaymentResult> {
  if (!provider) {
    return { ok: false, error: "unavailable" };
  }
  return db.transaction(async (tx): Promise<StartPaymentResult> => {
    // Locked, so two tabs retrying at once get attempts 2 and 3 instead of clashing on 2.
    const order = await findPayableOrder(tx, orderId, { lock: true });
    if (!order || !isPayable(order)) {
      return { ok: false, error: "not-payable" };
    }
    const reference = `${orderId}-${(await countPayments(tx, orderId)) + 1}`;
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
      resultUrl: new URL(`/checkout/success/${orderId}`, origin).toString(),
      callbackUrl: new URL("/payments/callback", origin).toString(),
      locale,
    });
    return { ok: true, redirectUrl, reference };
  });
}

export type PaymentCallbackResult =
  | Exclude<ParsedCallback, { ok: true }>
  | { ok: false; error: "unavailable" }
  /** `ignored`: unknown reference, a repeat, an amount mismatch or an order that can't be paid. */
  | { ok: true; result: "paid" | "failed" | "pending" | "ignored" };

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
        if (await markOrderPaid(tx, payment.orderId)) {
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
  return (await findLatestPaymentStatus(db, orderId)) === "failed" ? "failed" : "pending";
}
