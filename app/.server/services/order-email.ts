// Order confirmation emails (#45). `createOrder` queues one in `order_emails` inside the order's
// transaction; this module renders and sends queued emails. The checkout action tries its order's
// email right after the commit, and `pnpm db:send-order-emails` retries whatever failed, with the
// backoff below. Nothing here ever fails a checkout.
import type Mail from "nodemailer/lib/mailer";
import type { OrderConfirmation } from "~/lib/checkout";
import { PAYMENT_KEYS } from "~/lib/checkout";
import type { Translator } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";
import type { MailEnv } from "../env";
import { stripLineBreaks } from "../mail";

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
