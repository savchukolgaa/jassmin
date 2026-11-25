// The one follow-up after a delivered tester order (#191): "Which one did you like?", a card per
// perfume tried (photo, name, the lowest full-bottle price, a link to its page with the code), the
// personal code and its last day, and a one-click unsubscribe (RFC 8058). Built when it is sent,
// from `findTesterFollowup`, in the language it was queued in.
import type { Translator } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n/locales";
import { productHref } from "~/lib/products";
import type { TesterFollowup, TesterFollowupProduct } from "../db/queries/tester-followups";
import { composeEmail, type EmailBlock } from "../email/layout";
import { listUnsubscribeHeaders, photoOf, unsubscribeUrl } from "../email/marketing";
import { stripLineBreaks } from "../mail";
import { createUnsubscribeToken } from "../unsubscribe-token";
import type { OrderEmailEnv, OrderEmailMessage } from "./order-email";

/** The UTM tags of the email's links, so its visits count for the `tester_followup` campaign. */
export const TESTER_FOLLOWUP_UTM = {
  utm_source: "email",
  utm_medium: "email",
  utm_campaign: "tester_followup",
} as const;

/** What the links need: the site's origin and the secret that signs the unsubscribe token. */
export interface TesterFollowupLinks {
  siteUrl: string;
  unsubscribeSecret: string;
}

/** The code with its last whole day and the percent, as the email shows them. */
export interface TesterFollowupOffer {
  code: string;
  percent: string;
  endsAt: Date;
}

/**
 * The product page in `locale` with `?code=` (the page carries it into "add to cart", which
 * applies it in the cart) and the UTM tags.
 */
export function testerFollowupUrl(
  siteUrl: string,
  locale: Locale,
  product: Pick<TesterFollowupProduct, "publicId" | "slug">,
  code: string,
): string {
  const search = new URLSearchParams({ code, ...TESTER_FOLLOWUP_UTM });
  return `${siteUrl}${productHref(locale, { id: product.publicId, slug: product.slug })}?${search}`;
}

/** `"10.00"` → `"10"`, `"12.50"` → `"12.5"`. */
function percentOf(value: string): string {
  return String(Number(value));
}

/**
 * The last day the code is valid all day: its end is exclusive, so the day before the moment
 * it ends (in the shop's time zone, as `formatDate` shows dates).
 */
function lastValidDay(endsAt: Date): Date {
  return new Date(endsAt.getTime() - 24 * 60 * 60 * 1000);
}

/** The follow-up for `followup`'s order, in the translator's language. */
export function buildTesterFollowupEmail(
  followup: TesterFollowup,
  offer: TesterFollowupOffer,
  translator: Translator,
  env: OrderEmailEnv,
  { siteUrl, unsubscribeSecret }: TesterFollowupLinks,
): OrderEmailMessage {
  const { t, formatPrice, formatDate, locale } = translator;
  const fullName = stripLineBreaks(followup.fullName);
  const percent = percentOf(offer.percent);
  const unsubscribe = unsubscribeUrl(
    siteUrl,
    locale,
    createUnsubscribeToken(followup.userId, unsubscribeSecret),
  );
  const urlOf = (product: TesterFollowupProduct) =>
    testerFollowupUrl(siteUrl, locale, product, offer.code);
  const [first] = followup.products;
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: t("testerFollowupEmail.greeting", { name: fullName }) },
    { type: "paragraph", text: t("testerFollowupEmail.intro") },
    { type: "heading", text: t("testerFollowupEmail.productsHeading") },
    {
      type: "products",
      items: followup.products.map((product) => ({
        name: `${product.brand} ${product.title}`.trim(),
        details: t("testerFollowupEmail.priceFrom", { price: formatPrice(product.fromPrice) }),
        imageUrl: photoOf(product.imageUrl, siteUrl),
        url: urlOf(product),
      })),
    },
    { type: "paragraph", text: t("testerFollowupEmail.offer", { percent }) },
    {
      type: "code",
      label: t("testerFollowupEmail.codeLabel"),
      code: offer.code,
      note: t("testerFollowupEmail.codeNote", {
        date: formatDate(lastValidDay(offer.endsAt).toISOString()),
      }),
    },
    ...(first
      ? [{ type: "button", label: t("testerFollowupEmail.button"), url: urlOf(first) } as const]
      : []),
    { type: "paragraph", text: t("testerFollowupEmail.howTo") },
    { type: "paragraph", text: t("testerFollowupEmail.contact", { email: env.CONTACT_INBOX }) },
    { type: "signature", text: t("testerFollowupEmail.signature") },
    { type: "paragraph", text: t("testerFollowupEmail.why") },
  ];
  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: followup.email },
    replyTo: env.CONTACT_INBOX,
    subject: t("testerFollowupEmail.subject"),
    preheader: t("testerFollowupEmail.preheader", { percent }),
    blocks,
    translator,
    footer: { inbox: env.CONTACT_INBOX, siteUrl: env.PUBLIC_SITE_URL, unsubscribeUrl: unsubscribe },
    headers: listUnsubscribeHeaders(unsubscribe),
  });
}
