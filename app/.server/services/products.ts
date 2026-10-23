import { CATALOG_PAGE_SIZE, type CatalogGender, type CatalogSearch } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import type { CatalogPage, ProductDetail, ProductSummary } from "~/lib/products";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import {
  countProducts,
  findProductByPublicId,
  listFilterOptions,
  listProducts,
  type ProductDetailRow,
  type ProductSummaryRow,
} from "../db/queries/products";

/** Unisex perfumes appear in both the men's and the women's catalog. */
const GENDER_SCOPE: Record<CatalogGender, readonly Gender[]> = {
  men: ["men", "unisex"],
  women: ["women", "unisex"],
};

// The only place rows become DTOs, so moving price and stock to variants (#26) changes just this.
function toSummary(row: ProductSummaryRow): ProductSummary {
  return {
    id: row.publicId,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    price: row.price,
    volumeMl: row.volumeMl,
    packSize: row.packSize,
    imageUrl: row.imageUrl,
    inStock: row.stockQuantity > 0,
  };
}

function toDetail(row: ProductDetailRow): ProductDetail {
  return {
    ...toSummary(row),
    description: row.description,
    fragranceFamily: row.fragranceFamily,
    stockQuantity: row.stockQuantity,
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

/** The product with this `public_id`, or `null` when there is none. */
export async function getProduct(
  publicId: string,
  db: Db = defaultDb,
): Promise<ProductDetail | null> {
  const row = await findProductByPublicId(db, publicId);
  return row ? toDetail(row) : null;
}
