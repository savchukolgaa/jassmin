import type { CartActionError } from "~/lib/cart";
import { CATALOG_PAGE_SIZE, type CatalogGender, type CatalogSearch } from "~/lib/catalog";
import { GENDERS, type Gender } from "~/lib/enums";
import type { CatalogPage, ProductDetail, ProductSummary, ProductVariant } from "~/lib/products";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import {
  countProducts,
  findProductByPublicId,
  findVariantForProduct,
  listBestsellers,
  listFilterOptions,
  listProductSummariesByPublicIds,
  listProducts,
  listVariantsByProductId,
  type ProductDetailRow,
  type ProductSummaryRow,
  type ProductVariantRow,
} from "../db/queries/products";

/** Unisex perfumes appear in both the men's and the women's catalog. */
const GENDER_SCOPE: Record<CatalogGender, readonly Gender[]> = {
  men: ["men", "unisex"],
  women: ["women", "unisex"],
};

// The only place rows become DTOs.
function toSummary(row: ProductSummaryRow): ProductSummary {
  return {
    id: row.publicId,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    packSize: row.packSize,
    imageUrl: row.imageUrl,
    fragranceFamily: row.fragranceFamily,
    minPrice: row.minPrice,
    hasPriceRange: row.minPrice !== row.maxPrice,
    volumes: row.volumes,
    inStock: row.inStock,
    defaultVariant: { id: row.defaultVariantId, volumeMl: row.defaultVolumeMl },
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

function toDetail(row: ProductDetailRow, variants: ProductVariantRow[]): ProductDetail {
  return {
    id: row.publicId,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    packSize: row.packSize,
    imageUrl: row.imageUrl,
    description: row.description,
    fragranceFamily: row.fragranceFamily,
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
  const filters = { genders, fragranceFamily: search.fragranceFamily, brand: search.brand };
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

/**
 * The fragrance families of listed products of any gender, alphabetically, for the trio builder
 * and the marquee (#64). Shown as stored until #65 adds translated family labels.
 */
export async function getTrioFamilies(
  db: Db = defaultDb,
): Promise<{ value: string; label: string }[]> {
  const { fragranceFamilies } = await listFilterOptions(db, GENDERS);
  return fragranceFamilies.map((value) => ({ value, label: value }));
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
): Promise<ProductDetail | null> {
  return (await getProductWithId(publicId, db))?.product ?? null;
}

/**
 * Like `getProduct`, plus the serial `products.id` for server-side use (the `product_view` event,
 * #18). Never send `id` to the client.
 */
export async function getProductWithId(
  publicId: string,
  db: Db = defaultDb,
): Promise<{ id: number; product: ProductDetail } | null> {
  const row = await findProductByPublicId(db, publicId);
  if (!row) {
    return null;
  }
  return { id: row.id, product: toDetail(row, await listVariantsByProductId(db, row.id)) };
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
