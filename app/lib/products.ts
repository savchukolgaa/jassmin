// Product DTOs returned by the catalog and product loaders. `id` is the product's (and a
// variant's) `public_id`; serial ids and `created_at` never leave the server. Prices are exact
// decimal strings. Price, volume and stock belong to a product's variants (#26).
import type { Gender } from "./enums";
import { createTranslator, type Locale, type Translator } from "./i18n";
import type { ResponsiveImage } from "./images";
import { pathFor } from "./paths";

interface ProductBase {
  id: string;
  /** The URL slug (#83); `null` until the product is synced from Strapi. Link with `productHref`. */
  slug: string | null;
  title: string;
  brand: string;
  gender: Gender;
  /** Units per variant, e.g. 3 for a set of three testers. */
  packSize: number;
  /** The photo with Strapi's resized versions (#88); `null` without one. */
  image: ResponsiveImage | null;
}

/**
 * The product page's URL in `locale`: `/parfumy/<slug>` or `/en/perfumes/<slug>` (#83, #84), with
 * the public id for a product without a slug yet. The only place product links are built.
 */
export function productHref(locale: Locale, product: { id: string; slug: string | null }): string {
  return pathFor(locale, "product", { handle: product.slug ?? product.id });
}

/** A product's stored descriptions: `description` is Ukrainian, `descriptionEn` English (#100). */
export interface ProductDescriptions {
  description: string | null;
  descriptionEn: string | null;
}

/**
 * The description to show in `locale` (#100): that language's text, else the other language's,
 * so a page never goes without one while a translation is missing. Blank text counts as none.
 */
export function pickDescription(
  { description, descriptionEn }: ProductDescriptions,
  locale: Locale,
): { text: string; locale: Locale } | null {
  const texts: Record<Locale, string | undefined> = {
    uk: description?.trim() || undefined,
    en: descriptionEn?.trim() || undefined,
  };
  const other: Locale = locale === "en" ? "uk" : "en";
  for (const candidate of [locale, other]) {
    const text = texts[candidate];
    if (text) return { text, locale: candidate };
  }
  return null;
}

/** A description's paragraphs: separated by blank lines, trimmed, empty ones dropped. */
export function descriptionParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** A size on a product card (#74). No exact stock, which the card doesn't show. */
export type CardVariant = Pick<ProductVariant, "id" | "volumeMl" | "price" | "inStock">;

/**
 * A catalog card. Only products with at least one variant are listed. The price, stock and size
 * fields are derived from `variants`.
 */
export interface ProductSummary extends ProductBase {
  /** Every size, ascending by volume; never empty. The card's volume picker lists them (#74). */
  variants: CardVariant[];
  /** The lowest variant price. */
  minPrice: string;
  /** Whether the variants have different prices, so the card says "from". */
  hasPriceRange: boolean;
  /** The variants' volumes in ml, ascending. */
  volumes: number[];
  /** Whether any variant is in stock. */
  inStock: boolean;
  /** The variant the card's add button adds (see `defaultVariant`). */
  defaultVariant: { id: string; volumeMl: number };
  /** The primary fragrance family (stored Ukrainian value), if any (#65). */
  fragranceFamily: string | null;
}

export interface ProductDetail extends ProductBase {
  /**
   * Plain text in the page's language, or in the other one when it has none (#100); a blank line
   * separates paragraphs (`descriptionParagraphs`). `null` when neither language has one.
   */
  description: string | null;
  /** The language `description` is in; mark it with `useContentLang` when it's a fallback. */
  descriptionLocale: Locale;
  /** Stored Ukrainian values, primary first; label them with `fragranceFamilyLabel` (#65). */
  fragranceFamilies: string[];
  /** Scent notes, Ukrainian only (#65). */
  notes: string[];
  /** The shop's own code for the bottle, e.g. `3-D` (#65); `null` when staff left it blank. */
  storeCode: string | null;
  /** Ascending by volume; empty when the product has no sizes for sale. */
  variants: ProductVariant[];
}

export interface CatalogFilterOptions {
  brands: string[];
  fragranceFamilies: string[];
}

export interface CatalogPage {
  products: ProductSummary[];
  /** Products matching the filters, across all pages. */
  total: number;
  page: number;
  /** At least 1, so an empty catalog still has a page. */
  pageCount: number;
  filterOptions: CatalogFilterOptions;
}

/** Stock at or below this shows "Only N left". */
export const LOW_STOCK_THRESHOLD = 3;

/** `50 мл` / `50 ml`, or `3 × 10 мл` for a pack of several units. */
export function formatVolume(
  { volumeMl, packSize }: { volumeMl: number; packSize: number },
  { t }: Translator = createTranslator(),
) {
  const ml = t("product.ml");
  return packSize > 1 ? `${packSize} × ${volumeMl} ${ml}` : `${volumeMl} ${ml}`;
}

/** One size of a product. `id` is the variant's `public_id`, posted as `variantId`. */
export interface ProductVariant {
  id: string;
  volumeMl: number;
  price: string;
  stockQuantity: number;
  inStock: boolean;
}

/**
 * The size preselected for a product: the smallest one in stock, else the smallest one.
 * `undefined` when the product has no sizes.
 */
export function defaultVariant<T extends Pick<ProductVariant, "volumeMl" | "inStock">>(
  variants: readonly T[],
): T | undefined {
  const sorted = [...variants].sort((a, b) => a.volumeMl - b.volumeMl);
  return sorted.find((v) => v.inStock) ?? sorted[0];
}

/**
 * The price a card shows for the size picked in its volume picker (#74), or for its default size
 * when `selectedId` matches none of its sizes.
 */
export function cardPrice(
  product: Pick<ProductSummary, "variants" | "defaultVariant" | "minPrice">,
  selectedId: string,
): string {
  const { variants, defaultVariant } = product;
  const selected =
    variants.find((v) => v.id === selectedId) ?? variants.find((v) => v.id === defaultVariant.id);
  return selected?.price ?? product.minPrice;
}

/** A volume dropdown option, e.g. `30 мл — 1 450 ₴`, marked when that size is sold out. */
export function formatVariantOption(
  variant: Pick<ProductVariant, "volumeMl" | "price" | "inStock">,
  packSize: number,
  translator: Translator = createTranslator(),
) {
  const volume = formatVolume({ volumeMl: variant.volumeMl, packSize }, translator);
  const option = `${volume} — ${translator.formatPrice(variant.price)}`;
  return variant.inStock ? option : translator.t("product.soldOutOption", { option });
}
