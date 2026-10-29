import { and, arrayOverlaps, asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { CatalogSort } from "~/lib/catalog";
import type { Gender, OrderStatus } from "~/lib/enums";
import type { CardVariant } from "~/lib/products";
import type { Db } from "../client";
import { orderItems, orders, products, productVariants } from "../schema";

export interface ProductFilters {
  genders: readonly Gender[];
  /** Products with **any** of these families (#65); none or an empty list means no filter. */
  fragranceFamilies?: readonly string[];
  brand?: string;
}

/**
 * Only active products are listed or sold (#40): a product archived in Strapi keeps its row for
 * order history but disappears from the shop.
 */
const isListed = eq(products.active, true);

/**
 * A size's stock as the shop may sell it: 0 once its product is archived (#40). Queries that use
 * it must join `products`.
 */
export const availableStock = sql<number>`case when ${products.active} then ${productVariants.stockQuantity} else 0 end`;

/**
 * Products that have any of `families` among their `fragrance_families`, primary or not (#65),
 * via the GIN index. The one place to change for "all of these families" (`arrayContains`).
 */
function familyFilter(families: readonly string[] | undefined): SQL | undefined {
  return families?.length ? arrayOverlaps(products.fragranceFamilies, [...families]) : undefined;
}

// Shared by the list and the count, so the total always matches the listed products.
function whereFilters({ genders, fragranceFamilies, brand }: ProductFilters): SQL | undefined {
  return and(
    isListed,
    inArray(products.gender, [...genders]),
    familyFilter(fragranceFamilies),
    brand ? eq(products.brand, brand) : undefined,
  );
}

/**
 * Price and sizes per product, aggregated over its variants. Catalog queries inner-join it, so
 * products without variants aren't listed. `variants` is every size, smallest first (#74);
 * `price::text` keeps the exact decimal string, which a JSON number would not.
 */
function variantStats(db: Db) {
  return db
    .select({
      productId: productVariants.productId,
      minPrice: sql<string>`min(${productVariants.price})`.as("min_price"),
      maxPrice: sql<string>`max(${productVariants.price})`.as("max_price"),
      variants: sql<CardVariant[]>`json_agg(json_build_object(
        'id', ${productVariants.publicId},
        'volumeMl', ${productVariants.volumeMl},
        'price', ${productVariants.price}::text,
        'inStock', ${productVariants.stockQuantity} > 0
      ) order by ${productVariants.volumeMl})`.as("variants"),
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
    fragranceFamily: products.fragranceFamily,
    minPrice: stats.minPrice,
    maxPrice: stats.maxPrice,
    variants: stats.variants,
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
    .where(and(isListed, inArray(products.publicId, [...publicIds])));
}

/** Orders whose units count as sold for the bestsellers (#64). */
const SOLD_ORDER_STATUSES: OrderStatus[] = ["paid", "shipped", "completed"];

/** Units sold per product in paid, shipped or completed orders (#64). */
function soldUnits(db: Db) {
  return db
    .select({
      productId: orderItems.productId,
      units: sql<number>`sum(${orderItems.quantity})`.as("units"),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(inArray(orders.status, SOLD_ORDER_STATUSES))
    .groupBy(orderItems.productId)
    .as("sold");
}

type SoldUnits = ReturnType<typeof soldUnits>;

/** The bestseller order: most units sold, then the newest, with `id` as the tie-breaker. */
function bestsellerOrder(sold: SoldUnits): SQL[] {
  return [sql`coalesce(${sold.units}, 0) desc`, desc(products.createdAt), desc(products.id)];
}

/**
 * The listed products with the most units sold in paid, shipped or completed orders, then the
 * newest ones, so the list is full whenever enough products are listed (#64).
 */
export function listBestsellers(db: Db, limit: number): Promise<ProductSummaryRow[]> {
  const stats = variantStats(db);
  const sold = soldUnits(db);
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .leftJoin(sold, eq(sold.productId, products.id))
    .where(isListed)
    .orderBy(...bestsellerOrder(sold))
    .limit(limit);
}

export interface PopularFilters {
  /** Products with **any** of these families (the trio builder's picks); none means no filter. */
  fragranceFamilies?: readonly string[];
}

/**
 * The listed products of every gender for `/popular` (#67): the ones staff ranked, by
 * `popular_rank`, then the rest in the bestseller order. The caller decides how far into the
 * unranked ones to go (see `getPopularPage`).
 */
export function listPopularProducts(
  db: Db,
  { fragranceFamilies }: PopularFilters,
  options: { limit: number; offset: number },
): Promise<ProductSummaryRow[]> {
  const stats = variantStats(db);
  const sold = soldUnits(db);
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .leftJoin(sold, eq(sold.productId, products.id))
    .where(and(isListed, familyFilter(fragranceFamilies)))
    .orderBy(
      sql`${products.popularRank} is null`,
      asc(products.popularRank),
      ...bestsellerOrder(sold),
    )
    .limit(options.limit)
    .offset(options.offset);
}

/** How many products `listPopularProducts` can return, and how many of them staff ranked. */
export async function countPopularProducts(
  db: Db,
  { fragranceFamilies }: PopularFilters,
): Promise<{ ranked: number; listed: number }> {
  const stats = variantStats(db);
  const [row] = await db
    .select({
      ranked: sql<number>`count(*) filter (where ${products.popularRank} is not null)`.mapWith(
        Number,
      ),
      listed: count(),
    })
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .where(and(isListed, familyFilter(fragranceFamilies)));
  return { ranked: row?.ranked ?? 0, listed: row?.listed ?? 0 };
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

/**
 * Distinct brands and fragrance families of the listed products, alphabetically. Families count
 * every one of a product's `fragrance_families`, not only the primary (#65).
 */
export async function listFilterOptions(db: Db, genders: readonly Gender[]) {
  const listed = and(
    isListed,
    inArray(products.gender, [...genders]),
    inArray(products.id, db.select({ id: productVariants.productId }).from(productVariants)),
  );
  const family = db
    .select({ value: sql<string>`unnest(${products.fragranceFamilies})`.as("value") })
    .from(products)
    .where(listed)
    .as("family");
  const [brands, families] = await Promise.all([
    db
      .selectDistinct({ value: products.brand })
      .from(products)
      .where(listed)
      .orderBy(asc(products.brand)),
    db.selectDistinct({ value: family.value }).from(family).orderBy(asc(family.value)),
  ]);

  return {
    brands: brands.map((row) => row.value),
    fragranceFamilies: families.map((row) => row.value),
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
      fragranceFamilies: products.fragranceFamilies,
      notes: products.notes,
    })
    .from(products)
    .where(and(isListed, eq(products.publicId, publicId)))
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
      and(
        isListed,
        eq(products.publicId, productPublicId),
        eq(productVariants.publicId, variantPublicId),
      ),
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
  /** Always `fragranceFamilies[0] ?? null`: a CHECK enforces it (#65). */
  fragranceFamily: string | null;
  fragranceFamilies: string[];
  notes: string[];
  storeCode: string | null;
  /** Position on `/popular` (#67); `null` when not on the list. */
  popularRank: number | null;
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
      fragranceFamilies: products.fragranceFamilies,
      notes: products.notes,
      storeCode: products.storeCode,
      popularRank: products.popularRank,
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
