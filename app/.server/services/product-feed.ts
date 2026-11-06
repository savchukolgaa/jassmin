import { fragranceFamilyLabel } from "~/lib/catalog";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import type { Gender } from "~/lib/enums";
import { createTranslator, type Locale } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { formatVolume, pickDescription, productHref } from "~/lib/products";
import { absoluteUrl } from "~/lib/seo";
import { SHOP_BOTTLE_FEED_IMAGE_URL } from "~/lib/shop-bottle";
import { PRICE_CURRENCY } from "~/lib/structured-data";
import { db as defaultDb } from "../db";
import { type FeedVariantRow, listFeedVariants } from "../db/queries/products";
import {
  type FeedChannel,
  type FeedGender,
  type FeedItem,
  productFeedChunks,
} from "../seo/product-feed";

// The product feeds (#140): every perfume size on sale, in Ukrainian at `/feeds/products.xml` and
// in English at `/en/feeds/products.xml`, for Google Merchant Center and Meta Commerce Manager.

/** Google's limits for `title` and `description`. */
export const FEED_TITLE_MAX_LENGTH = 150;
export const FEED_DESCRIPTION_MAX_LENGTH = 5000;

const FEED_GENDERS: Record<Gender, FeedGender> = {
  women: "female",
  men: "male",
  unisex: "unisex",
};

/**
 * `g:brand`: the perfume house (#140). The title and description say it's a decant poured into
 * the shop's bottle, so the listing doesn't claim a sealed original. Should Google or Meta reject
 * items under their brand rules, return `"JASSMIN"` here (see `docs/product-feeds.md`).
 */
export function feedBrand(row: Pick<FeedVariantRow, "brand">): string {
  return row.brand;
}

/** `value` cut to at most `max` characters, at a word boundary when there's one, with `…`. */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Plain text on one line: every run of whitespace, line breaks included, becomes one space. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `title` without a leading `brand`, so "Dior Dior Sauvage" can't happen. */
function titleWithoutBrand(brand: string, title: string): string {
  const prefix = `${brand} `;
  return title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? title.slice(prefix.length)
    : title;
}

export interface FeedContext {
  locale: Locale;
  /** The public origin, e.g. `https://jassmin.ua`. */
  siteUrl: string;
}

/** The feed's items: one per row (a perfume size), in the rows' order. */
export function feedItems(rows: readonly FeedVariantRow[], { locale, siteUrl }: FeedContext) {
  const translator = createTranslator(locale);
  const { t } = translator;
  const origin = siteUrl.replace(/\/+$/, "");
  const bottle = absoluteUrl(SHOP_BOTTLE_FEED_IMAGE_URL, origin);

  return rows.flatMap((row): FeedItem[] => {
    // Never null: the query only returns slugged products. Checked for the types.
    if (row.slug === null) return [];
    const brand = feedBrand(row);
    const title = titleWithoutBrand(row.brand, row.title);
    const size = formatVolume({ volumeMl: row.volumeMl, packSize: row.packSize }, translator);
    const description = pickDescription(row, locale);
    const ownPhoto = row.imageUrl ? absoluteUrl(row.imageUrl, origin) : null;
    const family = row.fragranceFamily ? fragranceFamilyLabel(row.fragranceFamily, translator) : "";

    return [
      {
        id: row.variantId,
        groupId: row.productId,
        title: truncateText(
          collapseWhitespace(t("feed.itemTitle", { brand: row.brand, title, size })),
          FEED_TITLE_MAX_LENGTH,
        ),
        description: truncateText(
          collapseWhitespace(
            [t("feed.decantNote", { brand: row.brand, title, size }), description?.text ?? ""].join(
              " ",
            ),
          ),
          FEED_DESCRIPTION_MAX_LENGTH,
        ),
        link: absoluteUrl(productHref(locale, { id: row.productId, slug: row.slug }), origin),
        imageLink: ownPhoto ?? bottle,
        additionalImageLinks: ownPhoto ? [bottle] : [],
        price: `${row.price} ${PRICE_CURRENCY}`,
        availability: row.stock > 0 ? "in_stock" : "out_of_stock",
        brand,
        productType: [t(`feed.gender.${row.gender}`), family].filter(Boolean).join(" > "),
        gender: FEED_GENDERS[row.gender],
        size,
      },
    ];
  });
}

/** The channel: the shop's name, its home page and a line about it, in `locale`. */
export function feedChannel({ locale, siteUrl }: FeedContext): FeedChannel {
  const { t } = createTranslator(locale);
  return {
    title: t("feed.channelTitle"),
    link: absoluteUrl(pathFor(locale, "home"), siteUrl.replace(/\/+$/, "")),
    description: t("feed.channelDescription"),
  };
}

export interface ProductFeedDeps {
  listVariants: () => Promise<readonly FeedVariantRow[]>;
}

/**
 * The feed in `locale` as XML chunks. The rows are read first, so a database error is thrown
 * before anything is sent.
 */
export async function getProductFeed(
  context: FeedContext,
  deps: ProductFeedDeps = { listVariants: () => listFeedVariants(defaultDb) },
): Promise<Iterable<string>> {
  const rows = await deps.listVariants();
  return productFeedChunks(feedChannel(context), feedItems(rows, context), {
    freeShippingThreshold: `${FREE_SHIPPING_THRESHOLD} ${PRICE_CURRENCY}`,
  });
}
