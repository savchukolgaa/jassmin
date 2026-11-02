import { z } from "zod";
import type { CartActionError } from "~/lib/cart";
import { CATALOG_PAGE_SIZE, type CatalogGender, type CatalogSearch } from "~/lib/catalog";
import { GENDERS, type Gender } from "~/lib/enums";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import { type ImageFormat, type ResponsiveImage, toResponsiveImage } from "~/lib/images";
import type { PopularFilter, PopularPage } from "~/lib/popular";
import {
  type CatalogPage,
  defaultVariant,
  type ProductDetail,
  type ProductSummary,
  type ProductVariant,
  pickDescription,
} from "~/lib/products";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { findProductIdBySlugHistory } from "../db/queries/product-slugs";
import {
  countPopularProducts,
  countProducts,
  findListedProductSlug,
  findProductByPublicId,
  findProductBySlug,
  findVariantForProduct,
  listBestsellers,
  listFilterOptions,
  listPopularProducts,
  listProductSummariesByPublicIds,
  listProducts,
  listSimilarProducts,
  listVariantsByProductId,
  type ProductDetailRow,
  type ProductSummaryRow,
  type ProductVariantRow,
} from "../db/queries/products";

/** Unisex perfumes appear in both the men's and the women's catalog. */
export const GENDER_SCOPE: Record<CatalogGender, readonly Gender[]> = {
  men: ["men", "unisex"],
  women: ["women", "unisex"],
};

/** A row's image columns (#88). */
export interface ProductImageColumns {
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageFormats: ImageFormat[] | null;
}

/** The product photo's responsive image from its columns (#88). */
export function productImage(row: ProductImageColumns): ResponsiveImage | null {
  return toResponsiveImage(row.imageUrl, row.imageWidth, row.imageHeight, row.imageFormats);
}

// The only place rows become DTOs.
function toSummary(row: ProductSummaryRow): ProductSummary {
  const { variants } = row;
  // Never undefined: the catalog queries inner-join the variants, so every row has one.
  const preselected = defaultVariant(variants);
  if (!preselected) {
    throw new Error(`Product ${row.publicId} has no variants`);
  }
  return {
    id: row.publicId,
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    packSize: row.packSize,
    image: productImage(row),
    fragranceFamily: row.fragranceFamily,
    minPrice: row.minPrice,
    hasPriceRange: row.minPrice !== row.maxPrice,
    variants,
    volumes: variants.map((v) => v.volumeMl),
    inStock: variants.some((v) => v.inStock),
    defaultVariant: { id: preselected.id, volumeMl: preselected.volumeMl },
  };
}

function toVariant(row: ProductVariantRow): ProductVariant {
  return {
    id: row.publicId,
    volumeMl: row.volumeMl,
    price: row.price,
    stockQuantity: row.stockQuantity,
    inStock: row.stockQuantity > 0,
  };
}

function toDetail(
  row: ProductDetailRow,
  variants: ProductVariantRow[],
  locale: Locale,
): ProductDetail {
  const description = pickDescription(row, locale);
  return {
    id: row.publicId,
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    packSize: row.packSize,
    image: productImage(row),
    description: description?.text ?? null,
    descriptionLocale: description?.locale ?? locale,
    fragranceFamilies: row.fragranceFamilies,
    notes: row.notes,
    storeCode: row.storeCode,
    variants: variants.map(toVariant),
  };
}

/** One page of a gender's catalog with the filters applied, plus the options for the filters. */
export async function getCatalogPage(
  gender: CatalogGender,
  search: CatalogSearch,
  db: Db = defaultDb,
): Promise<CatalogPage> {
  const genders = GENDER_SCOPE[gender];
  const filters = {
    genders,
    // One family from the URL today; the queries already take a list (#64's trio builder).
    fragranceFamilies: search.fragranceFamily ? [search.fragranceFamily] : [],
    brand: search.brand,
  };
  const [rows, total, filterOptions] = await Promise.all([
    listProducts(db, filters, {
      sort: search.sort,
      limit: CATALOG_PAGE_SIZE,
      offset: (search.page - 1) * CATALOG_PAGE_SIZE,
    }),
    countProducts(db, filters),
    listFilterOptions(db, genders),
  ]);

  return {
    products: rows.map(toSummary),
    total,
    page: search.page,
    pageCount: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)),
    filterOptions,
  };
}

/** How many bestsellers the home page shows (#64). */
export const BESTSELLER_COUNT = 4;

/** The home page's bestsellers: most units sold, topped up with the newest products (#64). */
export async function getBestsellers(db: Db = defaultDb): Promise<ProductSummary[]> {
  return (await listBestsellers(db, BESTSELLER_COUNT)).map(toSummary);
}

/** Cards per page of `/popular`, like the catalog (#67). */
export const POPULAR_PAGE_SIZE = CATALOG_PAGE_SIZE;

/**
 * One page of `/popular` (#67): every listed product staff ranked, in their order, narrowed to
 * the filter's `families` (any of them) and `gender` (#102, with unisex, like the catalogs) when
 * given. When fewer than a page are ranked, the best-selling
 * unranked products fill the first page, so it is never empty while products are listed; the list
 * never grows into the whole catalog. A page past the end shows the last one.
 */
export async function getPopularPage(
  { families, gender }: PopularFilter,
  page: number,
  db: Db = defaultDb,
): Promise<PopularPage> {
  const filters = {
    fragranceFamilies: families,
    genders: gender ? GENDER_SCOPE[gender] : undefined,
  };
  const { ranked, listed } = await countPopularProducts(db, filters);
  const total = Math.max(ranked, Math.min(POPULAR_PAGE_SIZE, listed));
  const pageCount = Math.max(1, Math.ceil(total / POPULAR_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const offset = (current - 1) * POPULAR_PAGE_SIZE;
  const limit = Math.min(POPULAR_PAGE_SIZE, total - offset);
  const rows = limit > 0 ? await listPopularProducts(db, filters, { limit, offset }) : [];
  return { products: rows.map(toSummary), total, page: current, pageCount };
}

/**
 * Every fragrance family of the listed products of any gender (primary or not, #65), for the trio
 * builder and the marquee (#64). Stored values; the UI labels them in its language.
 */
export async function getTrioFamilies(db: Db = defaultDb): Promise<string[]> {
  return (await listFilterOptions(db, GENDERS)).fragranceFamilies;
}

/**
 * Product cards by `public_id`, for pages that pick products by hand (special offers, #55). Ids of
 * products that don't exist or have nothing for sale are missing from the map. One query.
 */
export async function getProductSummaries(
  publicIds: readonly string[],
  db: Db = defaultDb,
): Promise<Map<string, ProductSummary>> {
  if (publicIds.length === 0) {
    return new Map();
  }
  const rows = await listProductSummariesByPublicIds(db, [...new Set(publicIds)]);
  return new Map(rows.map((row) => [row.publicId, toSummary(row)]));
}

/** The product with this `public_id`, or `null` when there is none. */
export async function getProduct(
  publicId: string,
  db: Db = defaultDb,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ProductDetail | null> {
  return (await getProductWithId(publicId, db, locale))?.product ?? null;
}

/**
 * Like `getProduct`, plus the serial `products.id` for server-side use (the `product_view` event,
 * #18). Never send `id` to the client.
 */
export async function getProductWithId(
  publicId: string,
  db: Db = defaultDb,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ id: number; product: ProductDetail } | null> {
  const row = await findProductByPublicId(db, publicId);
  if (!row) {
    return null;
  }
  return { id: row.id, product: await detailOf(row, db, locale) };
}

export type ProductHandleResult =
  /**
   * Render the page; `id` is the serial id, for server-side use only. `available` is `false` for
   * an archived product (#88): its page stays, without a way to buy it.
   */
  | { kind: "product"; id: number; product: ProductDetail; available: boolean }
  /** Answer 301 to `productHref({ id: publicId, slug })`, the product's current URL. */
  | { kind: "redirect"; publicId: string; slug: string };

/**
 * What `/products/:handle` shows (#83). A UUID is a `public_id`: its product renders when it has
 * no slug yet, otherwise it redirects to the slug URL. Anything else is a slug: the current one
 * renders, a former one (`product_slug_history`) redirects to the current one. Archived products
 * are found too, marked unavailable (#88). `null` (a 404) for an unknown handle. The description
 * is in `locale`, the page's language (#100).
 */
export async function resolveProductHandle(
  handle: string,
  locale: Locale,
  db: Db = defaultDb,
): Promise<ProductHandleResult | null> {
  const options = { includeArchived: true };
  if (z.uuid().safeParse(handle).success) {
    const row = await findProductByPublicId(db, handle, options);
    if (!row) return null;
    if (row.slug !== null) {
      return { kind: "redirect", publicId: row.publicId, slug: row.slug };
    }
    return productResult(row, db, locale);
  }

  const row = await findProductBySlug(db, handle, options);
  if (row) {
    return productResult(row, db, locale);
  }

  const formerOwner = await findProductIdBySlugHistory(db, handle);
  if (formerOwner === undefined) return null;
  const current = await findListedProductSlug(db, formerOwner, options);
  if (!current?.slug) return null;
  return { kind: "redirect", publicId: current.publicId, slug: current.slug };
}

async function productResult(
  row: ProductDetailRow,
  db: Db,
  locale: Locale,
): Promise<ProductHandleResult> {
  const product = await detailOf(row, db, locale);
  if (row.active) {
    return { kind: "product", id: row.id, product, available: true };
  }
  // Nothing of an archived product is for sale (#40), whatever its sizes' stock says.
  const variants = product.variants.map((v) => ({ ...v, stockQuantity: 0, inStock: false }));
  return { kind: "product", id: row.id, product: { ...product, variants }, available: false };
}

async function detailOf(row: ProductDetailRow, db: Db, locale: Locale): Promise<ProductDetail> {
  return toDetail(row, await listVariantsByProductId(db, row.id), locale);
}

/** How many similar perfumes an archived product's page suggests (#88). */
export const SIMILAR_PRODUCTS_LIMIT = 4;

/**
 * Listed perfumes to suggest instead of an archived one (#88): from the catalog it was in, sharing
 * a fragrance family first, then its brand, then the popular ones.
 */
export async function getSimilarProducts(
  productId: number,
  product: Pick<ProductDetail, "gender" | "fragranceFamilies" | "brand">,
  db: Db = defaultDb,
): Promise<ProductSummary[]> {
  const rows = await listSimilarProducts(db, {
    excludeId: productId,
    genders: product.gender === "unisex" ? GENDERS : GENDER_SCOPE[product.gender],
    fragranceFamilies: product.fragranceFamilies,
    brand: product.brand,
    limit: SIMILAR_PRODUCTS_LIMIT,
  });
  return rows.map(toSummary);
}

export type VariantCheck =
  | { ok: true; variant: NonNullable<Awaited<ReturnType<typeof findVariantForProduct>>> }
  | { ok: false; error: Extract<CartActionError, "invalid-variant" | "out-of-stock"> };

/**
 * Whether the variant can be added to the cart: it must exist, belong to the product and be in
 * stock. Both ids are `public_id`s from the add-to-cart form.
 */
export async function checkVariantForCart(
  productId: string,
  variantId: string,
  db: Db = defaultDb,
): Promise<VariantCheck> {
  const variant = await findVariantForProduct(db, productId, variantId);
  if (!variant) {
    return { ok: false, error: "invalid-variant" };
  }
  if (variant.stockQuantity <= 0) {
    return { ok: false, error: "out-of-stock" };
  }
  return { ok: true, variant };
}
