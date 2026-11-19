// The newsletter email (#181): what staff wrote in Strapi (its body from Markdown), up to four
// featured products as cards with today's "from" price, a button to the shop and the one-click
// unsubscribe (RFC 8058). Every link to the shop carries the newsletter's UTM tags, so its visits
// and orders show up as `newsletter` in the acquisition analytics. Built when each email is sent.
import type { Translator } from "~/lib/i18n";
import type { NewsletterText } from "~/lib/newsletter";
import { newsletterUtm } from "~/lib/newsletter";
import { pathFor } from "~/lib/paths";
import { productHref } from "~/lib/products";
import { composeEmail, type EmailBlock } from "../email/layout";
import { markdownToEmailBlocks } from "../email/markdown";
import { listUnsubscribeHeaders, photoOf, withUtm } from "../email/marketing";
import { stripLineBreaks } from "../mail";
import type { OrderEmailEnv, OrderEmailMessage } from "./order-email";

/** A featured product as its card shows it, read when the email is sent. */
export interface NewsletterProduct {
  publicId: string;
  slug: string | null;
  title: string;
  brand: string;
  imageUrl: string | null;
  /** The lowest price of a size in stock, as an exact decimal. */
  minPrice: string;
  /** Whether the sizes in stock cost different amounts, so the card says "from". */
  hasPriceRange: boolean;
}

export interface NewsletterEmailInput {
  slug: string;
  /** The text in the email's language (the translator's). */
  text: NewsletterText;
  /** The featured products still on sale, in staff's order. */
  products: NewsletterProduct[];
  recipient: { fullName: string; email: string };
  /** The recipient's unsubscribe link; a test send to an address without an account has none. */
  unsubscribeUrl: string | null;
  /** A test send: the subject says so and a note at the top explains it. */
  test?: boolean;
}

/** The newsletter for one recipient, in the translator's language. */
export function buildNewsletterEmail(
  input: NewsletterEmailInput,
  translator: Translator,
  env: OrderEmailEnv,
  siteUrl: string,
): OrderEmailMessage {
  const { t, formatPrice, locale } = translator;
  const utm = newsletterUtm(input.slug);
  const tag = (href: string) => withUtm(href, siteUrl, utm);
  const fullName = stripLineBreaks(input.recipient.fullName);
  const subject = stripLineBreaks(input.text.subject);

  const blocks: EmailBlock[] = [
    ...(input.test ? [{ type: "paragraph", text: t("newsletterEmail.testNote") } as const] : []),
    { type: "paragraph", text: t("newsletterEmail.greeting", { name: fullName }) },
    ...markdownToEmailBlocks(input.text.body, tag),
  ];
  if (input.products.length > 0) {
    blocks.push(
      { type: "heading", text: t("newsletterEmail.productsHeading") },
      {
        type: "products",
        items: input.products.map((product) => {
          const price = formatPrice(product.minPrice);
          return {
            name: `${product.brand} ${product.title}`.trim(),
            details: product.hasPriceRange ? t("newsletterEmail.priceFrom", { price }) : price,
            imageUrl: photoOf(product.imageUrl, siteUrl),
            url: tag(productHref(locale, { id: product.publicId, slug: product.slug })),
          };
        }),
      },
    );
  }
  blocks.push(
    { type: "button", label: t("newsletterEmail.button"), url: tag(pathFor(locale, "home")) },
    { type: "paragraph", text: t("newsletterEmail.contact", { email: env.CONTACT_INBOX }) },
    { type: "signature", text: t("newsletterEmail.signature") },
    { type: "paragraph", text: t("newsletterEmail.why") },
  );

  return composeEmail({
    from: env.ORDER_FROM ?? env.CONTACT_FROM,
    to: { name: fullName, address: input.recipient.email },
    replyTo: env.CONTACT_INBOX,
    subject: input.test ? t("newsletterEmail.testSubject", { subject }) : subject,
    preheader: input.text.preheader ?? undefined,
    blocks,
    translator,
    footer: {
      inbox: env.CONTACT_INBOX,
      siteUrl: env.PUBLIC_SITE_URL,
      unsubscribeUrl: input.unsubscribeUrl ?? undefined,
    },
    headers: input.unsubscribeUrl ? listUnsubscribeHeaders(input.unsubscribeUrl) : undefined,
  });
}
