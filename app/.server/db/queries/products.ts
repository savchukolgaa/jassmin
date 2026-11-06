import {
  and,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { MAX_LINE_QUANTITY } from "~/lib/cart";
import type { CatalogSort } from "~/lib/catalog";
import type { Gender, OrderStatus } from "~/lib/enums";
import type { ImageFormat } from "~/lib/images";
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
 * The stock an untracked size (#98) reports: the most a cart line may hold, so it can never run
 * out, and the cart and checkout need no special case for it.
 */
export const UNTRACKED_STOCK = MAX_LINE_QUANTITY;

/**
 * A size's stock for selling, whatever its product's state: `stock_quantity` when the size tracks
 * stock, else `UNTRACKED_STOCK` (#98).
 */
export const variantStock = sql<number>`case when ${productVariants.trackStock} then ${productVariants.stockQuantity} else ${sql.raw(String(UNTRACKED_STOCK))} end`;

/**
 * A size's stock as the shop may sell it: `variantStock`, or 0 once its product is archived
 * (#40). Queries that use it must join `products`.
 */
export const availableStock = sql<number>`case when ${products.active} then ${variantStock} else 0 end`;

/**
 * Products that have any of `families` among their `fragrance_families`, primary or not (#65),
 * via the GIN index. The one place to change for "all of these families" (`arrayContains`).
 */
function familyFilter(families: readonly string[] | undefined): SQL | undefined {
  return families?.length ? arrayOverlaps(products.fragranceFamilies, [...families]) : undefined;
}

function genderFilter(genders: readonly Gender[] | undefined): SQL | undefined {
  return genders?.length ? inArray(products.gender, [...genders]) : undefined;
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
        'inStock', ${variantStock} > 0
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
    slug: products.slug,
    title: products.title,
    brand: products.brand,
    gender: products.gender,
    packSize: products.packSize,
    imageUrl: products.imageUrl,
    imageWidth: products.imageWidth,
    imageHeight: products.imageHeight,
    imageFormats: products.imageFormats,
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

/**
 * Every product page for `/sitemap.xml` (#87): listed products with at least one size, like the
 * catalog, and a slug. Products still without a slug are left out: their UUID URL would 301 once
 * Strapi gives them one. Ordered by slug, so the sitemap is stable between requests.
 */
export function listSitemapProducts(db: Db) {
  return db
    .select({ slug: products.slug, gender: products.gender, updatedAt: products.updatedAt })
    .from(products)
    .where(
      and(
        isListed,
        isNotNull(products.slug),
        exists(
          db
            .select({ one: sql`1` })
            .from(productVariants)
            .where(eq(productVariants.productId, products.id)),
        ),
      ),
    )
    .orderBy(asc(products.slug));
}

export type SitemapProductRow = Awaited<ReturnType<typeof listSitemapProducts>>[number];

/**
 * Every size for the product feeds (#140): one row per variant of a listed product with a slug
 * (as in the sitemap) and a price above 0, which Google requires. `stock` is the selling stock, so
 * untracked sizes (#98) are always in stock. Ordered by slug and volume, so the feed is stable.
 */
export function listFeedVariants(db: Db) {
  return db
    .select({
      productId: products.publicId,
      slug: products.slug,
      title: products.title,
      brand: products.brand,
      gender: products.gender,
      fragranceFamily: products.fragranceFamily,
      packSize: products.packSize,
      description: products.description,
      descriptionEn: products.descriptionEn,
      imageUrl: products.imageUrl,
      imageWidth: products.imageWidth,
      imageHeight: products.imageHeight,
      imageFormats: products.imageFormats,
      variantId: productVariants.publicId,
      volumeMl: productVariants.volumeMl,
      price: productVariants.price,
      stock: variantStock,
    })
    .from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(isListed, isNotNull(products.slug), sql`${productVariants.price} > 0`))
    .orderBy(asc(products.slug), asc(productVariants.volumeMl));
}

export type FeedVariantRow = Awaited<ReturnType<typeof listFeedVariants>>[number];

export interface PopularFilters {
  /** Products with **any** of these families (the trio builder's picks); none means no filter. */
  fragranceFamilies?: readonly string[];
  /** Products of these genders (the trio builder's gender scope, #102); none means every gender. */
  genders?: readonly Gender[];
}

/**
 * The listed products for `/popular` (#67): the ones staff ranked, by
 * `popular_rank`, then the rest in the bestseller order. The caller decides how far into the
 * unranked ones to go (see `getPopularPage`).
 */
export function listPopularProducts(
  db: Db,
  { fragranceFamilies, genders }: PopularFilters,
  options: { limit: number; offset: number },
): Promise<ProductSummaryRow[]> {
  const stats = variantStats(db);
  const sold = soldUnits(db);
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .leftJoin(sold, eq(sold.productId, products.id))
    .where(and(isListed, familyFilter(fragranceFamilies), genderFilter(genders)))
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
  { fragranceFamilies, genders }: PopularFilters,
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
    .where(and(isListed, familyFilter(fragranceFamilies), genderFilter(genders)));
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

/**
 * The columns of a product page (`ProductDetail`), plus the serial id and `updated_at` (the share
 * image's ETag, #105).
 */
const detailColumns = {
  id: products.id,
  publicId: products.publicId,
  slug: products.slug,
  title: products.title,
  brand: products.brand,
  gender: products.gender,
  packSize: products.packSize,
  imageUrl: products.imageUrl,
  imageWidth: products.imageWidth,
  imageHeight: products.imageHeight,
  imageFormats: products.imageFormats,
  description: products.description,
  descriptionEn: products.descriptionEn,
  fragranceFamilies: products.fragranceFamilies,
  notes: products.notes,
  storeCode: products.storeCode,
  active: products.active,
  updatedAt: products.updatedAt,
};

export interface ProductLookupOptions {
  /**
   * Also find archived products (#88): their page stays, marked unavailable. Everything that
   * sells (the cart, checkout) leaves this off.
   */
  includeArchived?: boolean;
}

const listedUnless = ({ includeArchived = false }: ProductLookupOptions) =>
  includeArchived ? undefined : isListed;

/** A listed product by `public_id`; an archived one too with `includeArchived`. */
export async function findProductByPublicId(
  db: Db,
  publicId: string,
  options: ProductLookupOptions = {},
) {
  const [row] = await db
    .select(detailColumns)
    .from(products)
    .where(and(listedUnless(options), eq(products.publicId, publicId)))
    .limit(1);
  return row;
}

/** A listed product by its current URL slug (#83); case-sensitive. */
export async function findProductBySlug(db: Db, slug: string, options: ProductLookupOptions = {}) {
  const [row] = await db
    .select(detailColumns)
    .from(products)
    .where(and(listedUnless(options), eq(products.slug, slug)))
    .limit(1);
  return row;
}

/** A listed product's `public_id` and current slug by serial id (#83). */
export async function findListedProductSlug(
  db: Db,
  productId: number,
  options: ProductLookupOptions = {},
) {
  const [row] = await db
    .select({ publicId: products.publicId, slug: products.slug })
    .from(products)
    .where(and(listedUnless(options), eq(products.id, productId)))
    .limit(1);
  return row;
}

export interface SimilarProductsQuery {
  /** The product itself, left out. */
  excludeId: number;
  genders: readonly Gender[];
  fragranceFamilies: readonly string[];
  brand: string;
  limit: number;
}

/**
 * Listed products like an archived one (#88), from the same catalog: those sharing a fragrance
 * family first, then the same brand, then staff's popular order and the bestsellers, so the list
 * is full whenever the catalog has enough products.
 */
export function listSimilarProducts(
  db: Db,
  { excludeId, genders, fragranceFamilies, brand, limit }: SimilarProductsQuery,
): Promise<ProductSummaryRow[]> {
  const stats = variantStats(db);
  const sold = soldUnits(db);
  const sharesFamily = fragranceFamilies.length
    ? sql`${arrayOverlaps(products.fragranceFamilies, [...fragranceFamilies])}`
    : sql`false`;
  return db
    .select(summaryColumns(stats))
    .from(products)
    .innerJoin(stats, eq(stats.productId, products.id))
    .leftJoin(sold, eq(sold.productId, products.id))
    .where(and(isListed, ne(products.id, excludeId), inArray(products.gender, [...genders])))
    .orderBy(
      sql`${sharesFamily} desc`,
      sql`${products.brand} = ${brand} desc`,
      sql`${products.popularRank} is null`,
      asc(products.popularRank),
      ...bestsellerOrder(sold),
    )
    .limit(limit);
}

export type ProductDetailRow = NonNullable<Awaited<ReturnType<typeof findProductByPublicId>>>;

const variantColumns = {
  publicId: productVariants.publicId,
  volumeMl: productVariants.volumeMl,
  price: productVariants.price,
  /** `variantStock`: `UNTRACKED_STOCK` for a size that doesn't count stock (#98). */
  stockQuantity: variantStock.mapWith(Number),
  trackStock: productVariants.trackStock,
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
    .select({
      ...variantColumns,
      id: productVariants.id,
      productId: productVariants.productId,
      productPublicId: products.publicId,
    })
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
  /** In Ukrainian. */
  description: string | null;
  /** In English (#100). */
  descriptionEn: string | null;
  gender: Gender;
  /** Always `fragranceFamilies[0] ?? null`: a CHECK enforces it (#65). */
  fragranceFamily: string | null;
  fragranceFamilies: string[];
  notes: string[];
  storeCode: string | null;
  /** Position on `/popular` (#67); `null` when not on the list. */
  popularRank: number | null;
  imageUrl: string | null;
  /** The image's size and Strapi's resized versions (#88); `null` when unknown. */
  imageWidth: number | null;
  imageHeight: number | null;
  imageFormats: ImageFormat[] | null;
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

/** The product's id and current slug, locking its row until the transaction ends. */
export async function lockProductByPublicId(
  db: Executor,
  publicId: string,
): Promise<{ id: number; slug: string | null } | undefined> {
  const [row] = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(eq(products.publicId, publicId))
    .for("update");
  return row;
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
      trackStock: productVariants.trackStock,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.id))
    .for("update");
}

/** A size as the CMS sync writes it. */
export interface VariantWrite {
  volumeMl: number;
  price: string;
  stockQuantity: number;
  /** `false`: always available, stock not counted (#98). */
  trackStock: boolean;
}

export async function insertVariants(
  db: Executor,
  productId: number,
  variants: readonly VariantWrite[],
): Promise<void> {
  if (variants.length === 0) return;
  await db.insert(productVariants).values(variants.map((v) => ({ productId, ...v })));
}

export async function updateVariant(
  db: Executor,
  variantId: number,
  variant: Omit<VariantWrite, "volumeMl">,
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
      descriptionEn: products.descriptionEn,
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
      trackStock: productVariants.trackStock,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.volumeMl));
  return { ...product, variants };
}

export type ProductSyncRow = NonNullable<Awaited<ReturnType<typeof findProductSyncState>>>;

/** A product's descriptions to fill in, by `public_id` (#100). */
export interface DescriptionFill {
  publicId: string;
  uk: string;
  en: string;
}

/**
 * Gives these products the descriptions they lack (#100), each language on its own: a `null` or
 * blank `description` gets `uk` and a `null` or blank `description_en` gets `en`, while any text
 * that's there, staff's included, stays exactly as it is. One `UPDATE` for all of them, which sets
 * `updated_at` itself (raw SQL skips `$onUpdate`). Returns the ids of the products it changed.
 */
export async function fillEmptyDescriptions(
  db: Pick<Db, "execute">,
  fills: readonly DescriptionFill[],
): Promise<number[]> {
  if (fills.length === 0) return [];
  const values = sql.join(
    fills.map(({ publicId, uk, en }) => sql`(${publicId}::uuid, ${uk}::text, ${en}::text)`),
    sql`, `,
  );
  const result = await db.execute<{ id: number }>(sql`
    update products p set
      description = case when nullif(btrim(p.description), '') is null
        then v.uk else p.description end,
      description_en = case when nullif(btrim(p.description_en), '') is null
        then v.en else p.description_en end,
      updated_at = now()
    from (values ${values}) as v(public_id, uk, en)
    where p.public_id = v.public_id
      and (nullif(btrim(p.description), '') is null or nullif(btrim(p.description_en), '') is null)
    returning p.id`);
  return result.rows.map((row) => Number(row.id));
}

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

/** A product's image columns as the Strapi sync stores them (#88). */
export interface ProductImageWrite {
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageFormats: ImageFormat[] | null;
}

/** Overwrites the image of the product with this `public_id`; `false` when there is none. */
export async function updateProductImage(
  db: Executor,
  publicId: string,
  image: ProductImageWrite,
): Promise<boolean> {
  const rows = await db
    .update(products)
    .set(image)
    .where(eq(products.publicId, publicId))
    .returning({ id: products.id });
  return rows.length > 0;
}
