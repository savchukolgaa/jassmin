import { and, asc, desc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import type { CatalogSort } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import type { Db } from "../client";
import { products } from "../schema";

export interface ProductFilters {
  genders: readonly Gender[];
  fragranceFamily?: string;
  brand?: string;
}

// Shared by the list and the count, so the total always matches the listed products.
function whereFilters({ genders, fragranceFamily, brand }: ProductFilters): SQL | undefined {
  return and(
    inArray(products.gender, [...genders]),
    fragranceFamily ? eq(products.fragranceFamily, fragranceFamily) : undefined,
    brand ? eq(products.brand, brand) : undefined,
  );
}

// The `id` tie-breaker keeps pagination stable when prices or creation times are equal.
const ORDER_BY: Record<CatalogSort, SQL[]> = {
  newest: [desc(products.createdAt), desc(products.id)],
  price_asc: [asc(products.price), asc(products.id)],
  price_desc: [desc(products.price), asc(products.id)],
};

const summaryColumns = {
  publicId: products.publicId,
  title: products.title,
  brand: products.brand,
  gender: products.gender,
  price: products.price,
  volumeMl: products.volumeMl,
  packSize: products.packSize,
  imageUrl: products.imageUrl,
  stockQuantity: products.stockQuantity,
};

const detailColumns = {
  ...summaryColumns,
  description: products.description,
  fragranceFamily: products.fragranceFamily,
};

export interface ListProductsOptions {
  sort: CatalogSort;
  limit: number;
  offset: number;
}

export function listProducts(db: Db, filters: ProductFilters, options: ListProductsOptions) {
  return db
    .select(summaryColumns)
    .from(products)
    .where(whereFilters(filters))
    .orderBy(...ORDER_BY[options.sort])
    .limit(options.limit)
    .offset(options.offset);
}

export type ProductSummaryRow = Awaited<ReturnType<typeof listProducts>>[number];

export function countProducts(db: Db, filters: ProductFilters): Promise<number> {
  return db.$count(products, whereFilters(filters));
}

/** Distinct brands and fragrance families among the given genders, alphabetically. */
export async function listFilterOptions(db: Db, genders: readonly Gender[]) {
  const inGenders = inArray(products.gender, [...genders]);
  const [brands, families] = await Promise.all([
    db
      .selectDistinct({ value: products.brand })
      .from(products)
      .where(inGenders)
      .orderBy(asc(products.brand)),
    db
      .selectDistinct({ value: products.fragranceFamily })
      .from(products)
      .where(and(inGenders, isNotNull(products.fragranceFamily)))
      .orderBy(asc(products.fragranceFamily)),
  ]);

  return {
    brands: brands.map((row) => row.value),
    fragranceFamilies: families.flatMap((row) => (row.value ? [row.value] : [])),
  };
}

export async function findProductByPublicId(db: Db, publicId: string) {
  const [row] = await db
    .select(detailColumns)
    .from(products)
    .where(eq(products.publicId, publicId))
    .limit(1);
  return row;
}

export type ProductDetailRow = NonNullable<Awaited<ReturnType<typeof findProductByPublicId>>>;
