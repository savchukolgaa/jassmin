// Order confirmation emails (#45) and gift card code emails (#125). `createOrder` queues the
// confirmation in `order_emails` inside the order's transaction, and the payment callback queues a
// paid gift card's emails inside its transaction; this module renders and sends queued emails.
// The checkout action (or the callback route) tries them right after the commit, and
// `pnpm db:send-order-emails` retries whatever failed, with the backoff below. Nothing here ever
// fails a checkout or a payment.
import type Mail from "nodemailer/lib/mailer";
import type { OrderConfirmation } from "~/lib/checkout";
import { PAYMENT_KEYS } from "~/lib/checkout";
import type { GiftCard } from "~/lib/commerce";
import { discountLabel } from "~/lib/discounts";
import { formatGiftCardCode } from "~/lib/gift-cards";
import { createTranslator, type Translator } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";
import type { Db } from "../db/client";
import { findGiftCard } from "../db/queries/gift-cards";
import {
  type ClaimedOrderEmail,
  claimOrderEmails,
  markOrderEmailFailed,
  markOrderEmailSent,
} from "../db/queries/order-emails";
import { findOrderConfirmation } from "../db/queries/orders";
import { composeEmail, type EmailAmount, type EmailBlock } from "../email/layout";
import type { MailEnv } from "../env";
import { type MailSender, stripLineBreaks } from "../mail";

/**
 * Minutes to wait before retrying after the 1st, 2nd, … failed attempt: about two days in all.
 * The email is given up (`failed`) after `MAX_ORDER_EMAIL_ATTEMPTS`.
 */
export const ORDER_EMAIL_RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440] as const;

export const MAX_ORDER_EMAIL_ATTEMPTS = ORDER_EMAIL_RETRY_DELAYS_MINUTES.length;

export type OrderEmailEnv = Pick<
  MailEnv,
  "ORDER_FROM" | "CONTACT_FROM" | "CONTACT_INBOX" | "PUBLIC_SITE_URL"
>;

/** A message from the shared layout (#134): HTML and text parts and a Message-ID. */
export type OrderEmailMessage = Mail.Options & { messageId: string };

/** The layout's footer for these emails: the shop's inbox and site. */
function footerOf(env: OrderEmailEnv) {
  return { inbox: env.CONTACT_INBOX, siteUrl: env.PUBLIC_SITE_URL };
}

/** The confirmation for a placed order, in the translator's language. */
export function buildOrderConfirmationEmail(
  order: OrderConfirmation,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t, formatPrice, formatDate } = translator;
  const fullName = stripLineBreaks(order.fullName);
  const payment = PAYMENT_KEYS[order.paymentMethod];

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

  const amounts: EmailAmount[] = [
    { label: t("checkout.subtotal"), value: formatPrice(order.subtotal) },
    ...(order.discount
      ? [
          {
            label: discountLabel(order.discount, translator),
            value: `−${formatPrice(order.discount.amount)}`,
          },
        ]
      : []),
    {
      label: t("checkout.shipping"),
      value: order.freeShipping ? t("checkout.shippingFree") : t("checkout.shippingCarrierRate"),
    },
    // What a gift card paid (#125), after the discount and delivery.
    ...(Number(order.giftCardAmount) > 0
      ? [{ label: t("checkout.giftCard.line"), value: `−${formatPrice(order.giftCardAmount)}` }]
      : []),
    { label: t("checkout.total"), value: formatPrice(order.totalAmount), strong: true },
  ];

  const blocks: EmailBlock[] = [
    { type: "paragraph", text: t("orderEmail.greeting", { name: fullName }) },
    {
      type: "paragraph",
      text: t("orderEmail.intro", {
        id: String(order.id),
        date: formatDate(order.createdAt.toISOString()),
        phone: order.phone,
      }),
    },
    { type: "heading", text: t("orderEmail.itemsHeading") },
    { type: "lines", items: lines },
    { type: "amounts", rows: amounts },
    { type: "heading", text: t("checkout.success.payment") },
    { type: "lines", items: [t(payment.label), t(payment.note)] },
    { type: "heading", text: t("checkout.success.delivery") },
    {
      type: "lines",
      items: [
        t("orderEmail.deliveryCarrier"),
        `${fullName}, ${order.phone}`,
        order.shippingAddress,
      ],
    },
    { type: "paragraph", text: t("orderEmail.contact", { email: env.CONTACT_INBOX }) },
    { type: "signature", text: t("orderEmail.signature") },
  ];

  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: order.email },
    replyTo: env.CONTACT_INBOX,
    // Only the order number: no user input in the subject.
    subject: t("orderEmail.subject", { id: String(order.id) }),
    blocks,
    translator,
    footer: footerOf(env),
  });
}

/** The card's code and expiry: the block both gift card emails share. */
function giftCardCode(
  card: GiftCard,
  translator: Translator,
  keys: "giftCardEmail" | "giftCardRecipientEmail",
): EmailBlock {
  const { t, formatDate } = translator;
  return {
    type: "code",
    label: t(`${keys}.code`),
    code: formatGiftCardCode(card.code),
    ...(card.expiresAt
      ? { note: t(`${keys}.expires`, { date: formatDate(card.expiresAt.toISOString()) }) }
      : {}),
  };
}

/** The email with a paid gift card's code to its buyer (#125). */
export function buildGiftCardEmail(
  card: GiftCard,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t, formatPrice } = translator;
  const amount = formatPrice(card.initialAmount);
  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: stripLineBreaks(card.buyerEmail),
    replyTo: env.CONTACT_INBOX,
    // Only the amount: no user input in the subject.
    subject: t("giftCardEmail.subject", { amount }),
    blocks: [
      { type: "paragraph", text: t("giftCardEmail.greeting") },
      {
        type: "lines",
        items: [
          t("giftCardEmail.intro", { amount }),
          ...(card.recipientEmail
            ? [t("giftCardEmail.recipientCopy", { email: stripLineBreaks(card.recipientEmail) })]
            : []),
        ],
      },
      giftCardCode(card, translator, "giftCardEmail"),
      { type: "paragraph", text: t("giftCardEmail.howTo") },
      { type: "paragraph", text: t("giftCardEmail.contact", { email: env.CONTACT_INBOX }) },
      { type: "signature", text: t("giftCardEmail.signature") },
    ],
    translator,
    footer: footerOf(env),
  });
}

/**
 * The email with a paid gift card's code to the recipient its buyer named (#125). It shows
 * nothing the buyer typed, so it can't carry their text to a stranger.
 */
export function buildGiftCardRecipientEmail(
  card: GiftCard,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  if (!card.recipientEmail) {
    throw new Error(`Gift card ${card.id} has no recipient`);
  }
  const { t, formatPrice } = translator;
  const amount = formatPrice(card.initialAmount);
  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: stripLineBreaks(card.recipientEmail),
    replyTo: env.CONTACT_INBOX,
    subject: t("giftCardRecipientEmail.subject", { amount }),
    blocks: [
      { type: "paragraph", text: t("giftCardRecipientEmail.greeting") },
      { type: "paragraph", text: t("giftCardRecipientEmail.intro", { amount }) },
      giftCardCode(card, translator, "giftCardRecipientEmail"),
      { type: "paragraph", text: t("giftCardRecipientEmail.howTo") },
      {
        type: "paragraph",
        text: t("giftCardRecipientEmail.contact", { email: env.CONTACT_INBOX }),
      },
      { type: "signature", text: t("giftCardRecipientEmail.signature") },
    ],
    translator,
    footer: footerOf(env),
  });
}

const GIFT_CARD_BUILDERS = {
  gift_card: buildGiftCardEmail,
  gift_card_recipient: buildGiftCardRecipientEmail,
} as const;

/** Rows the retry job claims at a time. */
export const ORDER_EMAIL_BATCH_SIZE = 50;

/** `last_error` keeps at most this many characters. */
const MAX_ERROR_LENGTH = 500;

/** What delivery needs; the queue functions are injectable so unit tests run without a database. */
export interface OrderEmailDeps {
  /** `null` when `SMTP_URL` is not configured. */
  mailer: MailSender | null;
  env: OrderEmailEnv;
  claim(options: {
    orderId?: number;
    giftCardId?: number;
    limit: number;
  }): Promise<ClaimedOrderEmail[]>;
  loadOrder(orderId: number): Promise<OrderConfirmation | undefined>;
  loadGiftCard(giftCardId: number): Promise<GiftCard | undefined>;
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
    loadGiftCard: (giftCardId) => findGiftCard(db, giftCardId),
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

/** The queued email's message, or `null` when its order or gift card is gone. */
async function buildEmail(
  email: ClaimedOrderEmail,
  deps: OrderEmailDeps,
): Promise<OrderEmailMessage | null> {
  const translator = createTranslator(email.locale);
  if (email.type === "confirmation") {
    const order = email.orderId === null ? undefined : await deps.loadOrder(email.orderId);
    return order ? buildOrderConfirmationEmail(order, translator, deps.env) : null;
  }
  const card = email.giftCardId === null ? undefined : await deps.loadGiftCard(email.giftCardId);
  return card ? GIFT_CARD_BUILDERS[email.type](card, translator, deps.env) : null;
}

async function deliverOne(
  email: ClaimedOrderEmail,
  mailer: MailSender,
  deps: OrderEmailDeps,
  report: OrderEmailReport,
): Promise<void> {
  const label =
    email.giftCardId === null
      ? `order ${email.orderId}'s ${email.type} email`
      : `gift card ${email.giftCardId}'s ${email.type} email`;
  try {
    const message = await buildEmail(email, deps);
    if (!message) {
      // Deleted orders and cards cascade to their emails, so this only happens in a race.
      console.error(`[order-email] Not sending ${label}: its order or gift card doesn't exist`);
      await deps.markFailed(email.id, { error: "Order or gift card not found", final: true });
      report.gaveUp += 1;
      return;
    }
    await mailer.sendMail(message);
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
 * Sends due queued emails: only `orderId`'s right after its checkout (or `giftCardId`'s right
 * after its payment), otherwise every due one in batches (the retry job). Never rejects: every failure is logged and left to the retries. `deps`
 * may be a factory, so an error while building them (e.g. the env) is caught too.
 *
 * This module doesn't import the app's pool (`db/index.ts`), which validates the web app's whole
 * env: the retry job brings its own. The app's wiring is `deliverOrderConfirmation` in
 * `services/orders.ts`.
 */
export async function deliverOrderEmails(
  {
    orderId,
    giftCardId,
    limit = ORDER_EMAIL_BATCH_SIZE,
  }: { orderId?: number; giftCardId?: number; limit?: number },
  deps: OrderEmailDeps | (() => OrderEmailDeps),
): Promise<OrderEmailReport> {
  const report: OrderEmailReport = { sent: 0, retrying: 0, gaveUp: 0, skipped: false };
  try {
    const resolved = typeof deps === "function" ? deps() : deps;
    const { mailer } = resolved;
    if (!mailer) {
      console.info(
        orderId !== undefined
          ? `[order-email] SMTP_URL is not set; order ${orderId}'s confirmation stays queued`
          : giftCardId !== undefined
            ? `[order-email] SMTP_URL is not set; gift card ${giftCardId}'s emails stay queued`
            : "[order-email] SMTP_URL is not set; queued order emails stay queued",
      );
      return { ...report, skipped: true };
    }
    // Claimed rows aren't due again until their retry time, so this loop ends.
    for (;;) {
      const batch = await resolved.claim({ orderId, giftCardId, limit });
      for (const email of batch) {
        await deliverOne(email, mailer, resolved, report);
      }
      if (orderId !== undefined || giftCardId !== undefined || batch.length < limit) break;
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
