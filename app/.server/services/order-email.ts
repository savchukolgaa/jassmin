// Order confirmation emails (#45). `createOrder` queues one in `order_emails` inside the order's
// transaction; this module renders and sends queued emails. The checkout action tries its order's
// email right after the commit, and `pnpm db:send-order-emails` retries whatever failed, with the
// backoff below. Nothing here ever fails a checkout.
import type Mail from "nodemailer/lib/mailer";
import type { OrderConfirmation } from "~/lib/checkout";
import { PAYMENT_KEYS } from "~/lib/checkout";
import { discountLabel } from "~/lib/discounts";
import type { OrderEmailType } from "~/lib/enums";
import { createTranslator, type Translator } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";
import type { Db } from "../db/client";
import {
  type ClaimedOrderEmail,
  claimOrderEmails,
  markOrderEmailFailed,
  markOrderEmailSent,
} from "../db/queries/order-emails";
import { findOrderConfirmation } from "../db/queries/orders";
import type { MailEnv } from "../env";
import { type MailSender, stripLineBreaks } from "../mail";

/**
 * Minutes to wait before retrying after the 1st, 2nd, … failed attempt: about two days in all.
 * The email is given up (`failed`) after `MAX_ORDER_EMAIL_ATTEMPTS`.
 */
export const ORDER_EMAIL_RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440] as const;

export const MAX_ORDER_EMAIL_ATTEMPTS = ORDER_EMAIL_RETRY_DELAYS_MINUTES.length;

export type OrderEmailEnv = Pick<MailEnv, "ORDER_FROM" | "CONTACT_FROM" | "CONTACT_INBOX">;

/** The plain-text confirmation for a placed order, in the translator's language. */
export function buildOrderConfirmationEmail(
  order: OrderConfirmation,
  translator: Translator,
  env: OrderEmailEnv,
): Mail.Options {
  const { t, formatPrice, formatDate } = translator;
  const fullName = stripLineBreaks(order.fullName);
  const payment = PAYMENT_KEYS[order.paymentMethod];
  const amount = (label: string, value: string) => t("orderEmail.amount", { label, amount: value });

  const lines = order.lines.map((line) => {
    const title = line.title ?? t("checkout.deletedProduct");
    const volume =
      line.volumeMl === null
        ? null
        : formatVolume({ volumeMl: line.volumeMl, packSize: line.packSize ?? 1 }, translator);
    const quantityPrice = t("orderEmail.quantityPrice", {
      quantity: line.quantity,
      price: formatPrice(line.unitPrice),
    });
    return t("orderEmail.line", {
      name: line.brand ? `${line.brand} ${title}` : title,
      details: [volume, quantityPrice].filter(Boolean).join(", "),
      total: formatPrice(line.lineTotal),
    });
  });

  const text = [
    t("orderEmail.greeting", { name: fullName }),
    "",
    t("orderEmail.intro", {
      id: String(order.id),
      date: formatDate(order.createdAt.toISOString()),
      phone: order.phone,
    }),
    "",
    t("orderEmail.itemsHeading"),
    ...lines,
    "",
    amount(t("checkout.subtotal"), formatPrice(order.subtotal)),
    ...(order.discount
      ? [
          amount(
            discountLabel(order.discount, translator),
            `−${formatPrice(order.discount.amount)}`,
          ),
        ]
      : []),
    amount(
      t("checkout.shipping"),
      order.freeShipping ? t("checkout.shippingFree") : t("checkout.shippingCarrierRate"),
    ),
    amount(t("checkout.total"), formatPrice(order.totalAmount)),
    "",
    t("checkout.success.payment"),
    t(payment.label),
    t(payment.note),
    "",
    t("checkout.success.delivery"),
    t("orderEmail.deliveryCarrier"),
    `${fullName}, ${order.phone}`,
    order.shippingAddress,
    "",
    t("orderEmail.contact", { email: env.CONTACT_INBOX }),
    "",
    t("orderEmail.signature"),
  ].join("\n");

  return {
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: order.email },
    replyTo: env.CONTACT_INBOX,
    // Only the order number: no user input in the subject.
    subject: t("orderEmail.subject", { id: String(order.id) }),
    text,
  };
}

const BUILDERS: Record<
  OrderEmailType,
  (order: OrderConfirmation, translator: Translator, env: OrderEmailEnv) => Mail.Options
> = {
  confirmation: buildOrderConfirmationEmail,
};

/** Rows the retry job claims at a time. */
export const ORDER_EMAIL_BATCH_SIZE = 50;

/** `last_error` keeps at most this many characters. */
const MAX_ERROR_LENGTH = 500;

/** What delivery needs; the queue functions are injectable so unit tests run without a database. */
export interface OrderEmailDeps {
  /** `null` when `SMTP_URL` is not configured. */
  mailer: MailSender | null;
  env: OrderEmailEnv;
  claim(options: { orderId?: number; limit: number }): Promise<ClaimedOrderEmail[]>;
  loadOrder(orderId: number): Promise<OrderConfirmation | undefined>;
  markSent(id: number): Promise<void>;
  markFailed(id: number, failure: { error: string; final: boolean }): Promise<void>;
}

/** The real queue on `db`; also used by `pnpm db:send-order-emails` with its own pool. */
export function orderEmailDeps(
  db: Db,
  mailer: MailSender | null,
  env: OrderEmailEnv,
): OrderEmailDeps {
  return {
    mailer,
    env,
    claim: (options) =>
      claimOrderEmails(db, { ...options, retryDelaysMinutes: ORDER_EMAIL_RETRY_DELAYS_MINUTES }),
    loadOrder: (orderId) => findOrderConfirmation(db, orderId),
    markSent: (id) => markOrderEmailSent(db, id),
    markFailed: (id, failure) => markOrderEmailFailed(db, id, failure),
  };
}

export interface OrderEmailReport {
  sent: number;
  /** Failed this time; due again after the backoff. */
  retrying: number;
  /** Failed for the last time (or the order is gone), now `failed`. */
  gaveUp: number;
  /** Nothing was tried because `SMTP_URL` is not set; the emails stay queued. */
  skipped: boolean;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

async function deliverOne(
  email: ClaimedOrderEmail,
  mailer: MailSender,
  deps: OrderEmailDeps,
  report: OrderEmailReport,
): Promise<void> {
  const label = `order ${email.orderId}'s ${email.type} email`;
  try {
    const order = await deps.loadOrder(email.orderId);
    if (!order) {
      // Deleted orders cascade to their emails, so this only happens in a race; don't retry.
      console.error(`[order-email] Not sending ${label}: the order doesn't exist`);
      await deps.markFailed(email.id, { error: "Order not found", final: true });
      report.gaveUp += 1;
      return;
    }
    const build = BUILDERS[email.type];
    await mailer.sendMail(build(order, createTranslator(email.locale), deps.env));
  } catch (error) {
    const final = email.attempts >= MAX_ORDER_EMAIL_ATTEMPTS;
    const message = errorMessage(error);
    console.error(
      `[order-email] Sending ${label} failed (attempt ${email.attempts} of ${MAX_ORDER_EMAIL_ATTEMPTS}${final ? ", giving up" : ""}): ${message}`,
    );
    await deps
      .markFailed(email.id, { error: message, final })
      .catch((markError: unknown) =>
        console.error(`[order-email] Recording the failure of ${label} failed:`, markError),
      );
    report[final ? "gaveUp" : "retrying"] += 1;
    return;
  }
  // Sent. If recording that fails, the row comes due again and the email is sent twice, which
  // beats losing it.
  report.sent += 1;
  await deps
    .markSent(email.id)
    .catch((markError: unknown) =>
      console.error(`[order-email] Recording ${label} as sent failed:`, markError),
    );
}

/**
 * Sends due queued emails: only `orderId`'s right after its checkout, otherwise every due one in
 * batches (the retry job). Never rejects: every failure is logged and left to the retries. `deps`
 * may be a factory, so an error while building them (e.g. the env) is caught too.
 *
 * This module doesn't import the app's pool (`db/index.ts`), which validates the web app's whole
 * env: the retry job brings its own. The app's wiring is `deliverOrderConfirmation` in
 * `services/orders.ts`.
 */
export async function deliverOrderEmails(
  { orderId, limit = ORDER_EMAIL_BATCH_SIZE }: { orderId?: number; limit?: number },
  deps: OrderEmailDeps | (() => OrderEmailDeps),
): Promise<OrderEmailReport> {
  const report: OrderEmailReport = { sent: 0, retrying: 0, gaveUp: 0, skipped: false };
  try {
    const resolved = typeof deps === "function" ? deps() : deps;
    const { mailer } = resolved;
    if (!mailer) {
      console.info(
        orderId === undefined
          ? "[order-email] SMTP_URL is not set; queued order emails stay queued"
          : `[order-email] SMTP_URL is not set; order ${orderId}'s confirmation stays queued`,
      );
      return { ...report, skipped: true };
    }
    // Claimed rows aren't due again until their retry time, so this loop ends.
    for (;;) {
      const batch = await resolved.claim({ orderId, limit });
      for (const email of batch) {
        await deliverOne(email, mailer, resolved, report);
      }
      if (orderId !== undefined || batch.length < limit) break;
    }
  } catch (error) {
    console.error("[order-email] Delivering order emails failed:", error);
  }
  return report;
}

/** The retry job's log line. */
export function describeOrderEmailReport({
  sent,
  retrying,
  gaveUp,
  skipped,
}: OrderEmailReport): string {
  if (skipped) {
    return "SMTP_URL is not set, so no order emails were sent; they stay queued.";
  }
  return `Order emails: ${sent} sent, ${retrying} to retry, ${gaveUp} given up.`;
}
