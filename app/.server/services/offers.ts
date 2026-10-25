import type { Offer } from "~/lib/cms";
import { createTranslator, DEFAULT_LOCALE, INTL_LOCALES, type Locale } from "~/lib/i18n";
import { toInternalPath } from "~/lib/links";
import {
  OFFER_GROUP_ORDER,
  type OfferGroupView,
  type OffersPageView,
  type OfferView,
} from "~/lib/offers";
import type { ProductSummary } from "~/lib/products";
import { renderMarkdown } from "../markdown";

// Prepares the active Strapi offers for the `/offers` route (#55). Offers are editorial: nothing
// here changes a price.

const SHOP_TIME_ZONE = "Europe/Kyiv";

/** "23:59" in shop time, or `null` at midnight, when the date alone says when the offer ends. */
function endTime(iso: string, locale: Locale): string | null {
  const time = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    timeZone: SHOP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return time === "00:00" ? null : time;
}

/**
 * When the offer ends, for "valid until". An offer that ends at midnight is valid until the end
 * of the day before, so that's the date shown.
 */
function validUntil(endsAt: string | null, locale: Locale): OfferView["validUntil"] {
  if (endsAt === null) {
    return null;
  }
  const time = endTime(endsAt, locale);
  const shownDay = time === null ? new Date(Date.parse(endsAt) - 1).toISOString() : endsAt;
  return { date: createTranslator(locale).formatDate(shownDay), time };
}

function toOfferView(
  offer: Offer,
  productsById: ReadonlyMap<string, ProductSummary>,
  locale: Locale,
): OfferView {
  const ctaPath = toInternalPath(offer.ctaUrl);
  return {
    slug: offer.slug,
    kind: offer.kind,
    contentLocale: offer.locale,
    title: offer.title,
    summary: offer.summary,
    bodyHtml: offer.body ? renderMarkdown(offer.body) : null,
    image: offer.image,
    priceNote: offer.priceNote,
    validUntil: validUntil(offer.endsAt, locale),
    cta: ctaPath ? { to: ctaPath, label: offer.ctaLabel } : null,
    products: offer.productIds.flatMap((id) => {
      const product = productsById.get(id);
      return product ? [product] : [];
    }),
  };
}

/**
 * Splits offers, already in editor order (`compareOffers`), into the hero, the perks strip and
 * the card groups.
 */
export function buildOffersPageView(
  offers: readonly Offer[],
  productsById: ReadonlyMap<string, ProductSummary>,
  locale: Locale = DEFAULT_LOCALE,
): OffersPageView {
  const views = offers.map((offer) => toOfferView(offer, productsById, locale));
  const perks = views.filter((view) => view.kind === "perk");
  const [hero = null, ...rest] = views.filter((view) => view.kind !== "perk");

  const groups: OfferGroupView[] = OFFER_GROUP_ORDER.flatMap((kind) => {
    const inGroup = rest.filter((view) => view.kind === kind);
    return inGroup.length > 0 ? [{ kind, offers: inGroup }] : [];
  });

  return { hero, perks, groups };
}

/** Every product the offers link to, once each, for a single lookup. */
export function offerProductIds(offers: readonly Offer[]): string[] {
  return [...new Set(offers.flatMap((offer) => offer.productIds))];
}
