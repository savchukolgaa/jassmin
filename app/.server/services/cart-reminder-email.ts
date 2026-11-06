// The one reminder email for an abandoned cart (#139): up to three of its lines with a photo, the
// total at today's prices, a button back to the cart (with the `abandoned_cart` UTM tags) and a
// one-click unsubscribe (RFC 8058). No discount: the plain effect is measured first. Built when
// it is sent, from `findCartReminder`, in the language the reminder was queued in.
import type { Translator } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n/locales";
import { pathFor } from "~/lib/paths";
import { formatVolume } from "~/lib/products";
import type { CartReminder } from "../db/queries/cart-reminders";
import { composeEmail, type EmailBlock } from "../email/layout";
import { stripLineBreaks } from "../mail";
import { createUnsubscribeToken } from "../unsubscribe-token";
import type { OrderEmailEnv, OrderEmailMessage } from "./order-email";

/** The UTM tags of the reminder's link, so its visits count for the `abandoned_cart` campaign. */
export const CART_REMINDER_UTM = {
  utm_source: "email",
  utm_medium: "email",
  utm_campaign: "abandoned_cart",
} as const;

/** The stand-in photo for a product without its own: the shop's bottle, a stable public file. */
export const EMAIL_BOTTLE_PHOTO_PATH = "/email/shop-bottle.jpg";

/** What the links need: the site's origin and the secret that signs the unsubscribe token. */
export interface CartReminderLinks {
  siteUrl: string;
  unsubscribeSecret: string;
}

/**
 * The cart page in `locale` with `restore=1` (the page offers to bring the reminded cart back, and
 * sends a logged-out visitor to log in first) and the UTM tags.
 */
export function cartReminderUrl(siteUrl: string, locale: Locale): string {
  const search = new URLSearchParams({ restore: "1", ...CART_REMINDER_UTM });
  return `${siteUrl}${pathFor(locale, "cart", {}, { search })}`;
}

/** The user's unsubscribe page in `locale`, also the `List-Unsubscribe` target. */
export function unsubscribeUrl(siteUrl: string, locale: Locale, token: string): string {
  return `${siteUrl}${pathFor(locale, "unsubscribe", { token })}`;
}

/** The headers that give mail clients a one-click unsubscribe button (RFC 2369 and RFC 8058). */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** A line's photo: its own when it has an absolute web URL, else the shop's bottle. */
function photoOf(imageUrl: string | null, siteUrl: string): string {
  return imageUrl && /^https?:\/\//i.test(imageUrl)
    ? imageUrl
    : `${siteUrl}${EMAIL_BOTTLE_PHOTO_PATH}`;
}

/** The reminder for `reminder`'s cart, in the translator's language. */
export function buildCartReminderEmail(
  reminder: CartReminder,
  translator: Translator,
  env: OrderEmailEnv,
  { siteUrl, unsubscribeSecret }: CartReminderLinks,
): OrderEmailMessage {
  const { t, formatPrice, locale } = translator;
  const fullName = stripLineBreaks(reminder.fullName);
  const unsubscribe = unsubscribeUrl(
    siteUrl,
    locale,
    createUnsubscribeToken(reminder.userId, unsubscribeSecret),
  );
  const more = reminder.availableLineCount - reminder.lines.length;
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: t("cartReminderEmail.greeting", { name: fullName }) },
    { type: "paragraph", text: t("cartReminderEmail.intro") },
    { type: "heading", text: t("cartReminderEmail.itemsHeading") },
    {
      type: "products",
      items: reminder.lines.map((line) => ({
        name: `${line.brand} ${line.title}`.trim(),
        details: t("cartReminderEmail.itemDetails", {
          volume: formatVolume(line, translator),
          quantity: line.quantity,
        }),
        imageUrl: photoOf(line.imageUrl, siteUrl),
      })),
    },
    ...(more > 0
      ? [{ type: "paragraph", text: t("cartReminderEmail.more", { count: more }) } as const]
      : []),
    {
      type: "amounts",
      rows: [
        {
          label: t("cartReminderEmail.total"),
          value: formatPrice(reminder.subtotal),
          strong: true,
        },
      ],
    },
    { type: "button", label: t("cartReminderEmail.button"), url: cartReminderUrl(siteUrl, locale) },
    { type: "paragraph", text: t("cartReminderEmail.loginNote") },
    { type: "paragraph", text: t("cartReminderEmail.contact", { email: env.CONTACT_INBOX }) },
    { type: "signature", text: t("cartReminderEmail.signature") },
    { type: "paragraph", text: t("cartReminderEmail.why") },
  ];
  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: reminder.email },
    replyTo: env.CONTACT_INBOX,
    subject: t("cartReminderEmail.subject"),
    preheader: t("cartReminderEmail.preheader"),
    blocks,
    translator,
    footer: { inbox: env.CONTACT_INBOX, siteUrl: env.PUBLIC_SITE_URL, unsubscribeUrl: unsubscribe },
    headers: listUnsubscribeHeaders(unsubscribe),
  });
}
