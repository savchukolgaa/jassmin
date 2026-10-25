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

/** The columns of a product card (`ProductSummary`), shared by every list of them. */
function summaryColumns(stats: VariantStats) {
  return {
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
  };
}

export function listProducts(db: Db, filters: ProductFilters, options: ListProductsOptions) {
  const stats = variantStats(db);
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .where(whereFilters(filters))
    .orderBy(...orderBy(options.sort, stats))
    .limit(options.limit)
    .offset(options.offset);
}

export type ProductSummaryRow = Awaited<ReturnType<typeof listProducts>>[number];

/**
 * The listed products with these `public_id`s, in no particular order. Like the catalog, products
 * without variants are left out. `publicIds` must be UUIDs: PostgreSQL rejects anything else.
 */
export function listProductSummariesByPublicIds(
  db: Db,
  publicIds: readonly string[],
): Promise<ProductSummaryRow[]> {
  const stats = variantStats(db);
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .where(inArray(products.publicId, [...publicIds]));
}

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

// Writes from the Strapi admin (#40), applied by `services/cms-sync.ts` in one transaction.

/** A `Db` or a transaction, so the sync service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

/** The catalog fields Strapi edits, plus the deprecated columns filled from the main size. */
export interface ProductWrite {
  title: string;
  slug: string;
  brand: string;
  description: string | null;
  gender: Gender;
  fragranceFamily: string | null;
  imageUrl: string | null;
  packSize: number;
  active: boolean;
  /** @deprecated columns (#26), still NOT NULL: copied from the smallest size. */
  price: string;
  volumeMl: number;
  stockQuantity: number;
}

export async function insertProduct(
  db: Executor,
  product: ProductWrite,
): Promise<{ id: number; publicId: string }> {
  const [row] = await db
    .insert(products)
    .values(product)
    .returning({ id: products.id, publicId: products.publicId });
  if (!row) {
    throw new Error("Could not insert the product");
  }
  return row;
}

/** The product's id, locking its row until the transaction ends. */
export async function lockProductByPublicId(
  db: Executor,
  publicId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.publicId, publicId))
    .for("update");
  return row?.id;
}

export async function updateProduct(
  db: Executor,
  productId: number,
  product: Partial<ProductWrite>,
): Promise<void> {
  await db.update(products).set(product).where(eq(products.id, productId));
}

/** The product's sizes, locking their rows until the transaction ends. */
export function lockVariantsByProductId(db: Executor, productId: number) {
  return db
    .select({
      id: productVariants.id,
      volumeMl: productVariants.volumeMl,
      stockQuantity: productVariants.stockQuantity,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.id))
    .for("update");
}

export async function insertVariants(
  db: Executor,
  productId: number,
  variants: readonly { volumeMl: number; price: string; stockQuantity: number }[],
): Promise<void> {
  if (variants.length === 0) return;
  await db.insert(productVariants).values(variants.map((v) => ({ productId, ...v })));
}

export async function updateVariant(
  db: Executor,
  variantId: number,
  variant: { price: string; stockQuantity: number },
): Promise<void> {
  await db.update(productVariants).set(variant).where(eq(productVariants.id, variantId));
}

/** Deletes sizes: their cart lines cascade, order lines keep their `volume_ml` snapshot. */
export async function deleteVariants(db: Executor, variantIds: readonly number[]): Promise<void> {
  if (variantIds.length === 0) return;
  await db.delete(productVariants).where(inArray(productVariants.id, [...variantIds]));
}

/** The product as Strapi should show it, with its sizes smallest first. */
export async function findProductSyncState(db: Executor, productId: number) {
  const [product] = await db
    .select({
      id: products.id,
      publicId: products.publicId,
      title: products.title,
      slug: products.slug,
      brand: products.brand,
      description: products.description,
      gender: products.gender,
      fragranceFamily: products.fragranceFamily,
      imageUrl: products.imageUrl,
      packSize: products.packSize,
      active: products.active,
    })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return undefined;
  const variants = await db
    .select({
      volumeMl: productVariants.volumeMl,
      price: productVariants.price,
      stock: productVariants.stockQuantity,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.volumeMl));
  return { ...product, variants };
}

export type ProductSyncRow = NonNullable<Awaited<ReturnType<typeof findProductSyncState>>>;

/**
 * Gives products without a slug (created before #40) one from their title and `public_id`,
 * e.g. `sauvage-eau-de-toilette-31d4a20a`, so Strapi, which requires one, can store them. Only
 * these products when `productIds` is given.
 */
export async function backfillProductSlugs(
  db: Executor,
  productIds?: readonly number[],
): Promise<void> {
  if (productIds?.length === 0) return;
  const base = sql`coalesce(nullif(trim(both '-' from lower(regexp_replace(${products.title}, '[^A-Za-z0-9]+', '-', 'g'))), ''), 'product')`;
  await db
    .update(products)
    .set({ slug: sql`left(${base}, 200) || '-' || right(${products.publicId}::text, 8)` })
    .where(
      and(
        sql`${products.slug} is null`,
        productIds ? inArray(products.id, [...productIds]) : undefined,
      ),
    );
}
