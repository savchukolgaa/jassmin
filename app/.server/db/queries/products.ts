import { and, asc, count, desc, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import type { CatalogSort } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import type { Db } from "../client";
import { products, productVariants } from "../schema";

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

// The default variant is the smallest in-stock size, else the smallest; keep this order in sync
// with `defaultVariant()` in ~/lib/products.
const DEFAULT_VARIANT_ORDER = sql`${productVariants.stockQuantity} = 0, ${productVariants.volumeMl}`;

/**
 * Price, stock and sizes per product, aggregated over its variants. Catalog queries inner-join
 * it, so products without variants aren't listed.
 */
function variantStats(db: Db) {
  return db
    .select({
      productId: productVariants.productId,
      minPrice: sql<string>`min(${productVariants.price})`.as("min_price"),
      maxPrice: sql<string>`max(${productVariants.price})`.as("max_price"),
      inStock: sql<boolean>`bool_or(${productVariants.stockQuantity} > 0)`.as("in_stock"),
      volumes: sql<
        number[]
      >`array_agg(${productVariants.volumeMl} order by ${productVariants.volumeMl})`.as("volumes"),
      defaultVariantId:
        sql<string>`(array_agg(${productVariants.publicId} order by ${DEFAULT_VARIANT_ORDER}))[1]`.as(
          "default_variant_id",
        ),
      defaultVolumeMl:
        sql<number>`(array_agg(${productVariants.volumeMl} order by ${DEFAULT_VARIANT_ORDER}))[1]`.as(
          "default_volume_ml",
        ),
    })
    .from(productVariants)
    .groupBy(productVariants.productId)
    .as("variant_stats");
}

type VariantStats = ReturnType<typeof variantStats>;

// The `id` tie-breaker keeps pagination stable when prices or creation times are equal.
function orderBy(sort: CatalogSort, stats: VariantStats): SQL[] {
  switch (sort) {
    case "newest":
      return [desc(products.createdAt), desc(products.id)];
    case "price_asc":
      return [asc(stats.minPrice), asc(products.id)];
    case "price_desc":
      return [desc(stats.minPrice), asc(products.id)];
  }
}

export interface ListProductsOptions {
  sort: CatalogSort;
  limit: number;
  offset: number;
}

export function listProducts(db: Db, filters: ProductFilters, options: ListProductsOptions) {
  const stats = variantStats(db);
  return db
    .select({
      publicId: products.publicId,
      title: products.title,
      brand: products.brand,
      gender: products.gender,
      packSize: products.packSize,
      imageUrl: products.imageUrl,
      minPrice: stats.minPrice,
      maxPrice: stats.maxPrice,
      inStock: stats.inStock,
      volumes: stats.volumes,
      defaultVariantId: stats.defaultVariantId,
      defaultVolumeMl: stats.defaultVolumeMl,
    })
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .where(whereFilters(filters))
    .orderBy(...orderBy(options.sort, stats))
    .limit(options.limit)
    .offset(options.offset);
}

export type ProductSummaryRow = Awaited<ReturnType<typeof listProducts>>[number];

export async function countProducts(db: Db, filters: ProductFilters): Promise<number> {
  const stats = variantStats(db);
  const [row] = await db
    .select({ total: count() })
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .where(whereFilters(filters));
  return row?.total ?? 0;
}

/** Distinct brands and fragrance families of the listed products, alphabetically. */
export async function listFilterOptions(db: Db, genders: readonly Gender[]) {
  const listed = and(
    inArray(products.gender, [...genders]),
    inArray(products.id, db.select({ id: productVariants.productId }).from(productVariants)),
  );
  const [brands, families] = await Promise.all([
    db
      .selectDistinct({ value: products.brand })
      .from(products)
      .where(listed)
      .orderBy(asc(products.brand)),
    db
      .selectDistinct({ value: products.fragranceFamily })
      .from(products)
      .where(and(listed, isNotNull(products.fragranceFamily)))
      .orderBy(asc(products.fragranceFamily)),
  ]);

  return {
    brands: brands.map((row) => row.value),
    fragranceFamilies: families.flatMap((row) => (row.value ? [row.value] : [])),
  };
}

export async function findProductByPublicId(db: Db, publicId: string) {
  const [row] = await db
    .select({
      id: products.id,
      publicId: products.publicId,
      title: products.title,
      brand: products.brand,
      gender: products.gender,
      packSize: products.packSize,
      imageUrl: products.imageUrl,
      description: products.description,
      fragranceFamily: products.fragranceFamily,
    })
    .from(products)
    .where(eq(products.publicId, publicId))
    .limit(1);
  return row;
}

export type ProductDetailRow = NonNullable<Awaited<ReturnType<typeof findProductByPublicId>>>;

const variantColumns = {
  publicId: productVariants.publicId,
  volumeMl: productVariants.volumeMl,
  price: productVariants.price,
  stockQuantity: productVariants.stockQuantity,
};

/** A product's variants, smallest first. */
export function listVariantsByProductId(db: Db, productId: number) {
  return db
    .select(variantColumns)
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.volumeMl));
}

export type ProductVariantRow = Awaited<ReturnType<typeof listVariantsByProductId>>[number];

/** The variant with this `public_id`, if it belongs to the product with this `public_id`. */
export async function findVariantForProduct(
  db: Db,
  productPublicId: string,
  variantPublicId: string,
) {
  const [row] = await db
    .select({ ...variantColumns, id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(eq(products.publicId, productPublicId), eq(productVariants.publicId, variantPublicId)),
    )
    .limit(1);
  return row;
}
