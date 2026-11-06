// Order confirmation emails (#45), gift card code emails (#125) and order status emails (#138).
// `createOrder` queues the confirmation in `order_emails` inside the order's transaction, the
// payment callback queues a paid gift card's emails inside its transaction, and a Strapi status
// change queues the status emails inside its own; this module renders and sends queued emails.
// The checkout action (or the callback route) tries them right after the commit, and
// `pnpm db:send-order-emails` retries whatever failed, with the backoff below. Nothing here ever
// fails a checkout or a payment.
import type Mail from "nodemailer/lib/mailer";
import type { OrderConfirmation, OrderStatusEmail } from "~/lib/checkout";
import { NOVA_POSHTA_FREE_STORAGE_DAYS, novaPoshtaTrackingUrl, PAYMENT_KEYS } from "~/lib/checkout";
import type { GiftCard } from "~/lib/commerce";
import { discountLabel } from "~/lib/discounts";
import type { OrderEmailType } from "~/lib/enums";
import { formatGiftCardCode } from "~/lib/gift-cards";
import { createTranslator, type Translator } from "~/lib/i18n";
import { isOrderStatusEmailType, type OrderStatusEmailType } from "~/lib/order-status-emails";
import { pathFor } from "~/lib/paths";
import { formatVolume } from "~/lib/products";
import type { Db } from "../db/client";
import { type CartReminder, findCartReminder } from "../db/queries/cart-reminders";
import { findGiftCard } from "../db/queries/gift-cards";
import {
  type ClaimedOrderEmail,
  claimOrderEmails,
  markOrderEmailFailed,
  markOrderEmailSent,
} from "../db/queries/order-emails";
import { findOrderConfirmation, findOrderStatusEmail } from "../db/queries/orders";
import { composeEmail, type EmailAmount, type EmailBlock } from "../email/layout";
import type { MailEnv } from "../env";
import { type MailSender, SuppressedRecipientError, stripLineBreaks } from "../mail";
import { buildCartReminderEmail } from "./cart-reminder-email";

/**
 * Minutes to wait before retrying after the 1st, 2nd, … failed attempt: about two days in all.
 * The email is given up (`failed`) after `MAX_ORDER_EMAIL_ATTEMPTS`.
 */
export const ORDER_EMAIL_RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440] as const;

export const MAX_ORDER_EMAIL_ATTEMPTS = ORDER_EMAIL_RETRY_DELAYS_MINUTES.length;

export type OrderEmailEnv = Pick<
  MailEnv,
  "ORDER_FROM" | "CONTACT_FROM" | "CONTACT_INBOX" | "PUBLIC_SITE_URL"
> &
  // Signs the unsubscribe link of a cart reminder (#139); optional for every other email.
  Partial<Pick<MailEnv, "EMAIL_UNSUBSCRIBE_SECRET">>;

/** A message from the shared layout (#134): HTML and text parts and a Message-ID. */
export type OrderEmailMessage = Mail.Options & { messageId: string };

/** The layout's footer for these emails: the shop's inbox and site. */
function footerOf(env: OrderEmailEnv) {
  return { inbox: env.CONTACT_INBOX, siteUrl: env.PUBLIC_SITE_URL };
}

/** The order's lines as the emails list them: name, size, quantity × price = total. */
function orderLineItems(order: OrderConfirmation, translator: Translator): string[] {
  const { t, formatPrice } = translator;
  return order.lines.map((line) => {
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
}

/** The carrier, the recipient and the branch address. */
function deliveryLines(order: OrderConfirmation, translator: Translator): EmailBlock {
  const fullName = stripLineBreaks(order.fullName);
  return {
    type: "lines",
    items: [
      translator.t("orderEmail.deliveryCarrier"),
      `${fullName}, ${order.phone}`,
      order.shippingAddress,
    ],
  };
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
  const lines = orderLineItems(order, translator);

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
    deliveryLines(order, translator),
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

/** The waybill number to copy and, as a button, its Nova Poshta tracking page. */
function waybillBlocks(waybillNumber: string, translator: Translator, note?: string): EmailBlock[] {
  const { t } = translator;
  return [
    {
      type: "code",
      label: t("orderStatusEmail.waybill"),
      code: waybillNumber,
      ...(note ? { note } : {}),
    },
    {
      type: "button",
      label: t("orderStatusEmail.track"),
      url: novaPoshtaTrackingUrl(waybillNumber),
    },
  ];
}

/**
 * A status email in the shared layout: greeting, `body` (the status and what to do next), the
 * order's lines and delivery, a link to the order for a registered customer, and the contact line.
 * The subject is the type's, with only the order number in it.
 */
function composeStatusEmail(
  type: OrderStatusEmailType,
  order: OrderStatusEmail,
  body: EmailBlock[],
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t } = translator;
  const fullName = stripLineBreaks(order.fullName);
  const id = String(order.id);
  // Guests' order pages only open in the browser they ordered in, so they get no link.
  const accountLink: EmailBlock[] =
    order.userId !== null && env.PUBLIC_SITE_URL
      ? [
          {
            type: "button",
            label: t("orderStatusEmail.account"),
            url: `${env.PUBLIC_SITE_URL}${pathFor(translator.locale, "accountOrder", { id })}`,
          },
        ]
      : [];
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: t("orderStatusEmail.greeting", { name: fullName }) },
    ...body,
    { type: "heading", text: t("orderStatusEmail.orderHeading", { id }) },
    { type: "lines", items: orderLineItems(order, translator) },
    { type: "heading", text: t("orderStatusEmail.deliveryHeading") },
    deliveryLines(order, translator),
    ...accountLink,
    { type: "paragraph", text: t("orderStatusEmail.contact", { email: env.CONTACT_INBOX }) },
    { type: "signature", text: t("orderStatusEmail.signature") },
  ];
  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: order.email },
    replyTo: env.CONTACT_INBOX,
    // Only the order number: no user input in the subject.
    subject: t(`orderStatusEmail.${type}.subject`, { id }),
    blocks,
    translator,
    footer: footerOf(env),
  });
}

/** A paragraph when `text` is given, nothing otherwise. */
function paragraphIf(text: string | false): EmailBlock[] {
  return text ? [{ type: "paragraph", text }] : [];
}

/** The order is on its way (#138), with the waybill and tracking link when staff entered one. */
export function buildOrderShippedEmail(
  order: OrderStatusEmail,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t } = translator;
  return composeStatusEmail(
    "shipped",
    order,
    [
      { type: "paragraph", text: t("orderStatusEmail.shipped.intro", { id: String(order.id) }) },
      ...(order.waybillNumber
        ? waybillBlocks(order.waybillNumber, translator, t("orderStatusEmail.shipped.waybillNote"))
        : []),
      { type: "paragraph", text: t("orderStatusEmail.shipped.next") },
    ],
    translator,
    env,
  );
}

/**
 * The parcel is at the branch (#138): the branch, how long it's kept for free, what to bring and
 * what is left to pay there.
 */
export function buildOrderArrivedEmail(
  order: OrderStatusEmail,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t, formatPrice } = translator;
  const amount = formatPrice(order.totalAmount);
  // Cash on delivery pays what's left at the branch; delivery is extra unless the shop pays it.
  const payment =
    order.paymentMethod === "cod" && order.paymentStatus === "unpaid"
      ? order.freeShipping
        ? t("orderStatusEmail.arrived.payCod", { amount })
        : t("orderStatusEmail.arrived.payCodCarrier", { amount })
      : order.freeShipping
        ? t("orderStatusEmail.arrived.paid")
        : t("orderStatusEmail.arrived.paidCarrier");
  return composeStatusEmail(
    "arrived",
    order,
    [
      { type: "paragraph", text: t("orderStatusEmail.arrived.intro", { id: String(order.id) }) },
      { type: "lines", items: [order.shippingAddress] },
      ...(order.waybillNumber ? waybillBlocks(order.waybillNumber, translator) : []),
      {
        type: "paragraph",
        text: t("orderStatusEmail.arrived.storage", { count: NOVA_POSHTA_FREE_STORAGE_DAYS }),
      },
      { type: "paragraph", text: t("orderStatusEmail.arrived.bring") },
      { type: "paragraph", text: payment },
    ],
    translator,
    env,
  );
}

/**
 * The order is cancelled (#138). A card payment will be refunded (its own email follows), and
 * what a gift card paid is already back on it (`restoreGiftCardRedemptions`, #125).
 */
export function buildOrderCancelledEmail(
  order: OrderStatusEmail,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t, formatPrice } = translator;
  const paidByCard = order.paymentMethod === "card" && order.paymentStatus !== "unpaid";
  return composeStatusEmail(
    "cancelled",
    order,
    [
      { type: "paragraph", text: t("orderStatusEmail.cancelled.intro", { id: String(order.id) }) },
      ...paragraphIf(
        paidByCard &&
          t("orderStatusEmail.cancelled.refundCard", { amount: formatPrice(order.totalAmount) }),
      ),
      ...paragraphIf(
        Number(order.giftCardAmount) > 0 &&
          t("orderStatusEmail.cancelled.giftCard", { amount: formatPrice(order.giftCardAmount) }),
      ),
      { type: "paragraph", text: t("orderStatusEmail.cancelled.next") },
    ],
    translator,
    env,
  );
}

/** The payment was refunded (#138): the amount and, for a card, how long the bank takes. */
export function buildOrderRefundedEmail(
  order: OrderStatusEmail,
  translator: Translator,
  env: OrderEmailEnv,
): OrderEmailMessage {
  const { t, formatPrice } = translator;
  return composeStatusEmail(
    "refunded",
    order,
    [
      {
        type: "paragraph",
        text: t("orderStatusEmail.refunded.intro", {
          id: String(order.id),
          amount: formatPrice(order.totalAmount),
        }),
      },
      ...paragraphIf(order.paymentMethod === "card" && t("orderStatusEmail.refunded.card")),
    ],
    translator,
    env,
  );
}

const ORDER_STATUS_BUILDERS = {
  shipped: buildOrderShippedEmail,
  arrived: buildOrderArrivedEmail,
  cancelled: buildOrderCancelledEmail,
  refunded: buildOrderRefundedEmail,
} as const satisfies Record<
  OrderStatusEmailType,
  (order: OrderStatusEmail, translator: Translator, env: OrderEmailEnv) => OrderEmailMessage
>;

const GIFT_CARD_BUILDERS = {
  gift_card: buildGiftCardEmail,
  gift_card_recipient: buildGiftCardRecipientEmail,
} as const;

/** The header that tags a sent order email with its `order_emails` id (#134). */
export const ORDER_EMAIL_TAG = "X-Mailin-custom";

/** The tag's value for an `order_emails` row, read back by `parseOrderEmailTag`. */
export function orderEmailTag(id: number): string {
  return `order-email:${id}`;
}

/** The `order_emails` id a webhook event's tag names, or `undefined`. */
export function parseOrderEmailTag(tag: string | undefined): number | undefined {
  const match = tag?.trim().match(/^order-email:(\d{1,9})$/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function orderEmailTagHeader(id: number): Record<string, string> {
  return { [ORDER_EMAIL_TAG]: orderEmailTag(id) };
}

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
    type?: OrderEmailType;
    limit: number;
  }): Promise<ClaimedOrderEmail[]>;
  loadOrder(orderId: number): Promise<OrderConfirmation | undefined>;
  /** The order as its status emails show it (#138). */
  loadOrderStatus(orderId: number): Promise<OrderStatusEmail | undefined>;
  loadGiftCard(giftCardId: number): Promise<GiftCard | undefined>;
  /** An abandoned cart's reminder (#139), read when it is sent. */
  loadCartReminder(cartId: number): Promise<CartReminder | undefined>;
  /** `messageId` is the Message-ID it went out with (#134), to match a later bounce. */
  markSent(id: number, messageId: string): Promise<void>;
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
    loadOrderStatus: (orderId) => findOrderStatusEmail(db, orderId),
    loadGiftCard: (giftCardId) => findGiftCard(db, giftCardId),
    loadCartReminder: (cartId) => findCartReminder(db, cartId),
    markSent: (id, messageId) => markOrderEmailSent(db, id, messageId),
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

/** A queued email that mustn't go out any more, and why (a cart reminder, #139). */
interface NotEligible {
  notEligible: string;
}

/**
 * Why a cart reminder may no longer be sent, or `undefined`: it was queued an hour or more ago,
 * or is a retry, so the rules are checked again (#139).
 */
function reminderNotEligible(reminder: CartReminder): string | undefined {
  if (!reminder.marketingOptIn) return "the user unsubscribed";
  if (reminder.orderedSince) return "the user ordered since";
  if (reminder.availableLineCount === 0) return "nothing in the cart is available";
  return undefined;
}

/** A cart reminder (#139): the message, `null` when the cart is gone, or why it isn't sent. */
async function buildCartReminder(
  email: ClaimedOrderEmail,
  translator: Translator,
  deps: OrderEmailDeps,
): Promise<OrderEmailMessage | NotEligible | null> {
  const reminder = email.cartId === null ? undefined : await deps.loadCartReminder(email.cartId);
  if (!reminder) {
    return null;
  }
  const reason = reminderNotEligible(reminder);
  if (reason) {
    return { notEligible: reason };
  }
  const { PUBLIC_SITE_URL: siteUrl, EMAIL_UNSUBSCRIBE_SECRET: unsubscribeSecret } = deps.env;
  if (!siteUrl || !unsubscribeSecret) {
    // No link back and no unsubscribe: the reminder job doesn't queue any then, so only a
    // misconfigured retry job gets here.
    return { notEligible: "PUBLIC_SITE_URL or EMAIL_UNSUBSCRIBE_SECRET is not set" };
  }
  return buildCartReminderEmail(reminder, translator, deps.env, { siteUrl, unsubscribeSecret });
}

/**
 * The queued email's message, `null` when its order, gift card or cart is gone, or why a cart
 * reminder isn't sent any more.
 */
async function buildEmail(
  email: ClaimedOrderEmail,
  deps: OrderEmailDeps,
): Promise<OrderEmailMessage | NotEligible | null> {
  const translator = createTranslator(email.locale);
  if (email.type === "confirmation") {
    const order = email.orderId === null ? undefined : await deps.loadOrder(email.orderId);
    return order ? buildOrderConfirmationEmail(order, translator, deps.env) : null;
  }
  if (isOrderStatusEmailType(email.type)) {
    const order = email.orderId === null ? undefined : await deps.loadOrderStatus(email.orderId);
    return order ? ORDER_STATUS_BUILDERS[email.type](order, translator, deps.env) : null;
  }
  if (email.type === "cart_reminder") {
    return buildCartReminder(email, translator, deps);
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
    email.cartId !== null
      ? `cart ${email.cartId}'s ${email.type} email`
      : email.giftCardId === null
        ? `order ${email.orderId}'s ${email.type} email`
        : `gift card ${email.giftCardId}'s ${email.type} email`;
  let messageId: string;
  try {
    const message = await buildEmail(email, deps);
    if (!message) {
      // Deleted orders and cards cascade to their emails, so this only happens in a race.
      console.error(
        `[order-email] Not sending ${label}: its order, gift card or cart doesn't exist`,
      );
      await deps.markFailed(email.id, {
        error: "Order, gift card or cart not found",
        final: true,
      });
      report.gaveUp += 1;
      return;
    }
    if ("notEligible" in message) {
      console.info(`[order-email] Not sending ${label}: ${message.notEligible}`);
      await deps.markFailed(email.id, {
        error: `not eligible: ${message.notEligible}`,
        final: true,
      });
      report.gaveUp += 1;
      return;
    }
    messageId = message.messageId;
    // Brevo echoes this tag in its webhook events, so a bounce finds its row (#134). The email's
    // own headers (a reminder's `List-Unsubscribe`, #139) are kept.
    await mailer.sendMail({
      ...message,
      headers: {
        ...(message.headers as Record<string, string> | undefined),
        ...orderEmailTagHeader(email.id),
      },
    });
  } catch (error) {
    if (error instanceof SuppressedRecipientError) {
      // The address bounced or complained before (#134): never retried.
      console.info(`[order-email] Not sending ${label}: ${error.message}`);
      await deps
        .markFailed(email.id, { error: `suppressed: ${error.reasons.join(", ")}`, final: true })
        .catch((markError: unknown) =>
          console.error(`[order-email] Recording the failure of ${label} failed:`, markError),
        );
      report.gaveUp += 1;
      return;
    }
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
    .markSent(email.id, messageId)
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
    type,
    limit = ORDER_EMAIL_BATCH_SIZE,
  }: { orderId?: number; giftCardId?: number; type?: OrderEmailType; limit?: number },
  deps: OrderEmailDeps | (() => OrderEmailDeps),
): Promise<OrderEmailReport> {
  const report: OrderEmailReport = { sent: 0, retrying: 0, gaveUp: 0, skipped: false };
  try {
    const resolved = typeof deps === "function" ? deps() : deps;
    const { mailer } = resolved;
    if (!mailer) {
      console.info(
        orderId !== undefined
          ? `[order-email] SMTP_URL is not set; order ${orderId}'s emails stay queued`
          : giftCardId !== undefined
            ? `[order-email] SMTP_URL is not set; gift card ${giftCardId}'s emails stay queued`
            : "[order-email] SMTP_URL is not set; queued order emails stay queued",
      );
      return { ...report, skipped: true };
    }
    // Claimed rows aren't due again until their retry time, so this loop ends.
    for (;;) {
      const batch = await resolved.claim({ orderId, giftCardId, type, limit });
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
