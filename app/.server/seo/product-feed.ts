import { xmlText } from "./xml";

// Builds the product feed (#140): RSS 2.0 with Google's `g:` namespace, the format Google Merchant
// Center and Meta Commerce Manager both read from a scheduled URL. One `<item>` per perfume size.
// Pure: the service (`services/product-feed.ts`) turns database rows into `FeedItem`s.

export const GOOGLE_NS = "http://base.google.com/ns/1.0";
/** Google's product taxonomy: Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne. */
export const FEED_CATEGORY_PERFUME = "479";
/** The feed's country for shipping attributes. */
export const FEED_COUNTRY = "UA";

export type FeedAvailability = "in_stock" | "out_of_stock";
export type FeedGender = "male" | "female" | "unisex";

export interface FeedChannel {
  title: string;
  /** The shop's home page in the feed's language, absolute. */
  link: string;
  description: string;
}

/** One perfume size, every field ready to print (prices as `"629.00 UAH"`, URLs absolute). */
export interface FeedItem {
  /** The variant's `public_id`. */
  id: string;
  /** The product's `public_id`: every size of a perfume shares it. */
  groupId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: readonly string[];
  price: string;
  availability: FeedAvailability;
  brand: string;
  productType: string;
  gender: FeedGender;
  size: string;
}

export interface FeedOptions {
  /** The order value from which delivery is free, e.g. `"1500.00 UAH"`. */
  freeShippingThreshold: string;
}

function element(name: string, value: string, indent = "      "): string {
  return `${indent}<${name}>${xmlText(value)}</${name}>`;
}

function itemXml(item: FeedItem, { freeShippingThreshold }: FeedOptions): string {
  return [
    "    <item>",
    element("g:id", item.id),
    element("g:item_group_id", item.groupId),
    element("title", item.title),
    element("description", item.description),
    element("link", item.link),
    element("g:image_link", item.imageLink),
    ...item.additionalImageLinks.map((link) => element("g:additional_image_link", link)),
    element("g:price", item.price),
    element("g:availability", item.availability),
    element("g:brand", item.brand),
    // Decants are poured into the shop's bottle (#118): new, without a GTIN or MPN.
    element("g:condition", "new"),
    element("g:identifier_exists", "no"),
    element("g:google_product_category", FEED_CATEGORY_PERFUME),
    element("g:product_type", item.productType),
    element("g:gender", item.gender),
    element("g:size", item.size),
    "      <g:free_shipping_threshold>",
    element("g:country", FEED_COUNTRY, "        "),
    element("g:price_threshold", freeShippingThreshold, "        "),
    "      </g:free_shipping_threshold>",
    "    </item>",
    "",
  ].join("\n");
}

/** The feed in pieces: the channel header, one chunk per item, then the closing tags. */
export function* productFeedChunks(
  channel: FeedChannel,
  items: Iterable<FeedItem>,
  options: FeedOptions,
): Generator<string> {
  yield [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:g="${GOOGLE_NS}">`,
    "  <channel>",
    element("title", channel.title, "    "),
    element("link", channel.link, "    "),
    element("description", channel.description, "    "),
    "",
  ].join("\n");
  for (const item of items) {
    yield itemXml(item, options);
  }
  yield "  </channel>\n</rss>\n";
}

/** The whole feed as one string. */
export function buildProductFeedXml(
  channel: FeedChannel,
  items: Iterable<FeedItem>,
  options: FeedOptions,
): string {
  return [...productFeedChunks(channel, items, options)].join("");
}
