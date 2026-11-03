import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSearch } from "~/lib/catalog";
import type { FragranceFamily } from "~/lib/enums";
import { SAMPLE_PRODUCTS } from "../db/seed-data";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

const DEFAULTS: CatalogSearch = { sort: "newest", page: 1 };

// The listed samples: the 3 × 10 ml tester set is seeded archived (#98).
const listedSamples = SAMPLE_PRODUCTS.filter((p) => p.active !== false);

const titlesOf = (genders: string[]) =>
  listedSamples.filter((p) => genders.includes(p.gender)).map((p) => p.title);

// Extra women's products, so the women's catalog has more than one page.
const PAGING_BRAND = "Paging House";
const PAGING_COUNT = 13;

// A men's product without variants: it has nothing for sale, so it's never listed.
const UNSOLD_BRAND = "Unsold House";

// A women's product archived in Strapi (#40): kept for order history, never listed or sold.
const ARCHIVED_BRAND = "Archived House";

// Women's products whose sizes don't track stock (#98): always available at stock 0.
const POURED_BRAND = "Poured House";
const POURED_ARCHIVED_BRAND = "Poured Archived House";

const sampleNamed = (prefix: string) => {
  const product = SAMPLE_PRODUCTS.find((p) => p.title.startsWith(prefix));
  if (!product) throw new Error(`No sample product ${prefix}`);
  return product;
};

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("products service", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    const { productVariants, products } = await import("../db/schema");
    testDb = await createTestDatabase("jassmin_products_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    const paging = await testDb.db
      .insert(products)
      .values(
        Array.from({ length: PAGING_COUNT }, (_, i) => ({
          title: `Paging ${i}`,
          brand: PAGING_BRAND,
          gender: "women" as const,
          price: `${100 + i}.00`,
          volumeMl: 30,
        })),
      )
      .returning({ id: products.id });
    await testDb.db
      .insert(productVariants)
      .values(paging.map(({ id }, i) => ({ productId: id, volumeMl: 30, price: `${100 + i}.00` })));
    await testDb.db.insert(products).values({
      title: "Unsold",
      brand: UNSOLD_BRAND,
      gender: "men",
      price: "1.00",
      volumeMl: 75,
    });
    const [archived] = await testDb.db
      .insert(products)
      .values({
        title: "Archived",
        brand: ARCHIVED_BRAND,
        gender: "women",
        fragranceFamily: "archived-family",
        fragranceFamilies: ["archived-family"],
        price: "500.00",
        volumeMl: 30,
        active: false,
      })
      .returning({ id: products.id });
    await testDb.db
      .insert(productVariants)
      .values({ productId: archived?.id ?? 0, volumeMl: 30, price: "500.00", stockQuantity: 5 });
    const poured = await testDb.db
      .insert(products)
      .values(
        [POURED_BRAND, POURED_ARCHIVED_BRAND].map((brand) => ({
          title: brand,
          brand,
          gender: "women" as const,
          price: "119.00",
          volumeMl: 5,
          active: brand === POURED_BRAND,
        })),
      )
      .returning({ id: products.id });
    await testDb.db.insert(productVariants).values(
      poured.flatMap(({ id }) => [
        { productId: id, volumeMl: 5, price: "119.00", stockQuantity: 0 },
        { productId: id, volumeMl: 100, price: "969.00", stockQuantity: 0, trackStock: true },
      ]),
    );
  });

  /** The archived product's public id and its only size's. */
  const archived = async () => {
    const { eq } = await import("drizzle-orm");
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .select({ publicId: products.publicId, variantId: productVariants.publicId })
      .from(products)
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(eq(products.brand, ARCHIVED_BRAND));
    if (!row) throw new Error("no archived product");
    return row;
  };

  afterAll(async () => {
    await testDb?.drop();
  });

  const catalog = async (gender: "men" | "women", search: Partial<CatalogSearch> = {}) => {
    const { getCatalogPage } = await import("./products");
    return getCatalogPage(gender, { ...DEFAULTS, ...search }, testDb.db);
  };

  it("lists men's and unisex products in the men's catalog", async () => {
    const page = await catalog("men");

    expect(page.products.map((p) => p.title).sort()).toEqual(titlesOf(["men", "unisex"]).sort());
    expect(page.total).toBe(page.products.length);
    expect(page.pageCount).toBe(1);
  });

  it("lists only women's and unisex products in the women's catalog", async () => {
    const page = await catalog("women");
    const all = [...page.products, ...(await catalog("women", { page: 2 })).products];

    expect(new Set(all.map((p) => p.gender))).toEqual(new Set(["women", "unisex"]));
    expect(all.map((p) => p.title)).toEqual(expect.arrayContaining(titlesOf(["women", "unisex"])));
    // Plus the paging products and the listed poured one (#98).
    expect(page.total).toBe(titlesOf(["women", "unisex"]).length + PAGING_COUNT + 1);
  });

  it("filters by brand and fragrance family", async () => {
    expect((await catalog("men", { brand: "Dior" })).products.map((p) => p.title)).toEqual([
      "Sauvage Eau de Toilette",
    ]);
    const withFamily = (family: string) =>
      listedSamples
        .filter((p) => p.fragranceFamilies.includes(family as FragranceFamily))
        .filter((p) => p.gender !== "women")
        .map((p) => p.title)
        .sort();
    const woody = await catalog("men", { fragranceFamily: "деревні" });
    expect(woody.products.map((p) => p.title).sort()).toEqual(withFamily("деревні"));
    // A secondary family finds the product too, not only a primary one (#65).
    expect(SAMPLE_PRODUCTS.some((p) => p.fragranceFamilies[0] === "ароматичні")).toBe(false);
    const aromatic = await catalog("men", { fragranceFamily: "ароматичні" });
    expect(aromatic.products.map((p) => p.title).sort()).toEqual(withFamily("ароматичні"));
    expect(aromatic.total).toBeGreaterThan(1);
    expect((await catalog("men", { fragranceFamily: "мікс" })).products).toEqual([]);
    expect((await catalog("men", { brand: "Nobody" })).products).toEqual([]);
  });

  it("sorts by the lowest variant price and by newest", async () => {
    const prices = (await catalog("men", { sort: "price_asc" })).products.map((p) =>
      Number(p.minPrice),
    );
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const desc = (await catalog("men", { sort: "price_desc" })).products.map((p) => p.minPrice);
    expect(desc).toEqual(
      (await catalog("men", { sort: "price_asc" })).products.map((p) => p.minPrice).reverse(),
    );

    // Seeded together, so the newest is the last inserted.
    const newest = await catalog("men");
    expect(newest.products[0]?.title).toBe(titlesOf(["men", "unisex"]).at(-1));
  });

  it("paginates", async () => {
    const first = await catalog("women", { brand: PAGING_BRAND });
    const second = await catalog("women", { brand: PAGING_BRAND, page: 2 });
    const beyond = await catalog("women", { brand: PAGING_BRAND, page: 3 });

    expect(first.products).toHaveLength(12);
    expect(second.products).toHaveLength(1);
    expect(first.pageCount).toBe(2);
    expect(beyond.products).toEqual([]);
    expect(beyond.total).toBe(PAGING_COUNT);
  });

  it("offers the brands and families of the catalog's genders", async () => {
    const { filterOptions } = await catalog("men");
    const scoped = listedSamples.filter((p) => p.gender !== "women");

    expect(filterOptions.brands).toEqual([...new Set(scoped.map((p) => p.brand))].sort());
    // Every family of a product, not only the primary (#65).
    expect(filterOptions.fragranceFamilies).toEqual(
      [...new Set(scoped.flatMap((p) => p.fragranceFamilies))].sort(),
    );
    expect(filterOptions.fragranceFamilies).not.toContain("archived-family");
  });

  it("summarises each product's variants on its card", async () => {
    const { products } = await catalog("men", { brand: "Giorgio Armani" });
    const [acqua] = products;

    // Sold out in every size: listed, out of stock, and the default is the smallest size.
    expect(acqua).toMatchObject({
      minPrice: "1990.00",
      hasPriceRange: true,
      volumes: [30, 100],
      inStock: false,
      defaultVariant: { id: expect.any(String), volumeMl: 30 },
      // The card shows the primary family only (#65).
      fragranceFamily: "водяні",
    });

    const coco = (await catalog("women", { brand: "Chanel" })).products[0];
    // 5 ml is the smallest size in stock (10 ml is sold out).
    expect(coco).toMatchObject({
      minPrice: "990.00",
      hasPriceRange: true,
      volumes: [5, 10, 30, 50, 100],
      inStock: true,
      defaultVariant: { volumeMl: 5 },
    });
    // Every size for the card's volume picker, smallest first, with exact prices (#74).
    expect(coco?.variants).toEqual([
      { id: expect.any(String), volumeMl: 5, price: "990.00", inStock: true },
      { id: expect.any(String), volumeMl: 10, price: "1350.00", inStock: false },
      { id: expect.any(String), volumeMl: 30, price: "4450.00", inStock: true },
      { id: expect.any(String), volumeMl: 50, price: "6850.00", inStock: true },
      { id: expect.any(String), volumeMl: 100, price: "9900.00", inStock: true },
    ]);
    expect(coco?.variants[0]?.id).toBe(coco?.defaultVariant.id);
    expect(new Set(coco?.variants.map((v) => v.id)).size).toBe(5);
    expect(acqua?.variants.map((v) => [v.volumeMl, v.inStock])).toEqual([
      [30, false],
      [100, false],
    ]);
    expect(acqua?.variants[0]?.id).toBe(acqua?.defaultVariant.id);

    // The tester set is archived (#98): the trio discount sells three testers instead.
    expect((await catalog("women", { brand: "Jassmin" })).products).toEqual([]);
  });

  it("doesn't list products without variants", async () => {
    const page = await catalog("men", { brand: UNSOLD_BRAND });

    expect(page.products).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.filterOptions.brands).not.toContain(UNSOLD_BRAND);
  });

  it("returns a product's details with its variants by public id, smallest first", async () => {
    const { getProduct } = await import("./products");
    const sauvage = sampleNamed("Sauvage");

    expect(await getProduct(sauvage.publicId, testDb.db)).toEqual({
      id: sauvage.publicId,
      slug: null,
      title: "Sauvage Eau de Toilette",
      brand: "Dior",
      gender: "men",
      packSize: 1,
      image: null,
      description: sauvage.description,
      descriptionLocale: "uk",
      fragranceFamilies: sauvage.fragranceFamilies,
      notes: sauvage.notes,
      // The sample catalog has no store codes; the imported range does (#66).
      storeCode: null,
      variants: [
        {
          id: expect.any(String),
          volumeMl: 10,
          price: "790.00",
          stockQuantity: 15,
          trackStock: true,
          inStock: true,
        },
        {
          id: expect.any(String),
          volumeMl: 50,
          price: "3290.00",
          stockQuantity: 6,
          trackStock: true,
          inStock: true,
        },
        {
          id: expect.any(String),
          volumeMl: 100,
          price: "4450.00",
          stockQuantity: 12,
          trackStock: true,
          inStock: true,
        },
      ],
    });
  });

  it("gives the description in the requested language, else in the other one (#100)", async () => {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const { getProduct } = await import("./products");
    const sauvage = sampleNamed("Sauvage");

    // The sample catalog has only Ukrainian descriptions.
    expect(await getProduct(sauvage.publicId, testDb.db, "en")).toMatchObject({
      description: sauvage.description,
      descriptionLocale: "uk",
    });
    await testDb.db
      .update(products)
      .set({ descriptionEn: "A fresh spicy scent." })
      .where(eq(products.publicId, sauvage.publicId));
    try {
      expect(await getProduct(sauvage.publicId, testDb.db, "en")).toMatchObject({
        description: "A fresh spicy scent.",
        descriptionLocale: "en",
      });
      expect(await getProduct(sauvage.publicId, testDb.db, "uk")).toMatchObject({
        description: sauvage.description,
        descriptionLocale: "uk",
      });
    } finally {
      await testDb.db
        .update(products)
        .set({ descriptionEn: null })
        .where(eq(products.publicId, sauvage.publicId));
    }
  });

  it("checks that a variant belongs to the product and is in stock", async () => {
    const { checkVariantForCart, getProduct } = await import("./products");
    const coco = await getProduct(sampleNamed("Coco").publicId, testDb.db);
    const sauvage = await getProduct(sampleNamed("Sauvage").publicId, testDb.db);
    const size = (volumeMl: number) => coco?.variants.find((v) => v.volumeMl === volumeMl)?.id;
    const check = (variantId: string | undefined, productId = coco?.id) =>
      checkVariantForCart(productId ?? "", variantId ?? "", testDb.db);

    expect(await check(size(50))).toEqual({
      ok: true,
      variant: expect.objectContaining({ volumeMl: 50, price: "6850.00", stockQuantity: 6 }),
    });
    expect(await check(size(10))).toEqual({ ok: false, error: "out-of-stock" });
    expect(await check(sauvage?.variants[0]?.id)).toEqual({ ok: false, error: "invalid-variant" });
    expect(await check("01a1652b-6e25-7c00-8000-000000000000")).toEqual({
      ok: false,
      error: "invalid-variant",
    });
    expect(await check(size(50), "01a1652b-6e25-7c00-8000-000000000000")).toEqual({
      ok: false,
      error: "invalid-variant",
    });
  });

  it("sells a size that doesn't track stock at stock 0, and a tracked one only in stock (#98)", async () => {
    const { checkVariantForCart, getProduct } = await import("./products");
    const { UNTRACKED_STOCK } = await import("../db/queries/products");
    const [card] = (await catalog("women", { brand: POURED_BRAND })).products;
    if (!card) throw new Error("no poured product");

    expect(card.inStock).toBe(true);
    expect(card.variants.map((v) => [v.volumeMl, v.inStock])).toEqual([
      [5, true],
      [100, false],
    ]);
    expect(card.defaultVariant.volumeMl).toBe(5);

    const detail = await getProduct(card.id, testDb.db);
    expect(detail?.variants).toEqual([
      expect.objectContaining({
        volumeMl: 5,
        stockQuantity: UNTRACKED_STOCK,
        trackStock: false,
        inStock: true,
      }),
      expect.objectContaining({
        volumeMl: 100,
        stockQuantity: 0,
        trackStock: true,
        inStock: false,
      }),
    ]);
    const size = (volumeMl: number) => detail?.variants.find((v) => v.volumeMl === volumeMl)?.id;
    expect(await checkVariantForCart(card.id, size(5) ?? "", testDb.db)).toEqual({
      ok: true,
      variant: expect.objectContaining({ volumeMl: 5, stockQuantity: UNTRACKED_STOCK }),
    });
    expect(await checkVariantForCart(card.id, size(100) ?? "", testDb.db)).toEqual({
      ok: false,
      error: "out-of-stock",
    });
  });

  it("sells nothing of an archived product, even a size that doesn't track stock (#98)", async () => {
    const { eq } = await import("drizzle-orm");
    const { products, productVariants } = await import("../db/schema");
    const { checkVariantForCart, resolveProductHandle } = await import("./products");
    const [row] = await testDb.db
      .select({ publicId: products.publicId, variantId: productVariants.publicId })
      .from(products)
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(eq(products.brand, POURED_ARCHIVED_BRAND))
      .orderBy(productVariants.volumeMl);
    if (!row) throw new Error("no archived poured product");

    expect((await catalog("women", { brand: POURED_ARCHIVED_BRAND })).products).toEqual([]);
    expect(await checkVariantForCart(row.publicId, row.variantId, testDb.db)).toEqual({
      ok: false,
      error: "invalid-variant",
    });
    const found = await resolveProductHandle(row.publicId, "uk", testDb.db);
    if (found?.kind !== "product") throw new Error("not a product");
    expect(found.product.variants.every((v) => !v.inStock)).toBe(true);
  });

  it("returns null for an unknown public id", async () => {
    const { getProduct, getProductWithId } = await import("./products");

    expect(await getProduct("01a1652b-6e25-7c00-8000-000000000000", testDb.db)).toBeNull();
    expect(await getProductWithId("01a1652b-6e25-7c00-8000-000000000000", testDb.db)).toBeNull();
  });

  it("gives the server the serial id next to the product", async () => {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const { getProduct, getProductWithId } = await import("./products");
    const sauvage = sampleNamed("Sauvage");
    const [row] = await testDb.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.publicId, sauvage.publicId));

    expect(await getProductWithId(sauvage.publicId, testDb.db)).toEqual({
      id: row?.id,
      product: await getProduct(sauvage.publicId, testDb.db),
    });
  });

  it("resolves /products/:handle by slug, public id and former slug (#83)", async () => {
    const { products } = await import("../db/schema");
    const { recordOldSlug } = await import("../db/queries/product-slugs");
    const { resolveProductHandle } = await import("./products");
    // Products without sizes, so the catalog tests above don't see them.
    const base = { brand: "Handle House", gender: "men" as const, price: "1.00", volumeMl: 30 };
    const [slugged, unslugged, archived] = await testDb.db
      .insert(products)
      .values([
        { ...base, title: "Slugged", slug: "handle-slugged" },
        { ...base, title: "Unslugged" },
        { ...base, title: "Archived", slug: "handle-archived", active: false },
      ])
      .returning({ id: products.id, publicId: products.publicId });
    if (!slugged || !unslugged || !archived) throw new Error("insert failed");
    await recordOldSlug(testDb.db, slugged.id, "handle-old");
    await recordOldSlug(testDb.db, archived.id, "handle-archived-old");
    const resolve = (handle: string) => resolveProductHandle(handle, "uk", testDb.db);

    expect(await resolve("handle-slugged")).toMatchObject({
      kind: "product",
      available: true,
      id: slugged.id,
      product: { id: slugged.publicId, slug: "handle-slugged", title: "Slugged", variants: [] },
      // The share image's cache key (#105).
      updatedAt: expect.any(Date),
    });
    expect(await resolve(slugged.publicId)).toEqual({
      kind: "redirect",
      publicId: slugged.publicId,
      slug: "handle-slugged",
    });
    expect(await resolve("handle-old")).toEqual({
      kind: "redirect",
      publicId: slugged.publicId,
      slug: "handle-slugged",
    });
    expect(await resolve(unslugged.publicId)).toMatchObject({
      kind: "product",
      id: unslugged.id,
      product: { slug: null, title: "Unslugged" },
    });

    // Unknown or differently cased: a 404.
    expect(await resolve("handle-unknown")).toBeNull();
    expect(await resolve("HANDLE-SLUGGED")).toBeNull();
    expect(await resolve("01a1652b-6e25-7fff-8000-000000000000")).toBeNull();

    // Archived, however it is named: its page stays, unavailable (#88).
    expect(await resolve("handle-archived")).toMatchObject({
      kind: "product",
      available: false,
      id: archived.id,
      product: { title: "Archived" },
      updatedAt: expect.any(Date),
    });
    const archivedTarget = {
      kind: "redirect",
      publicId: archived.publicId,
      slug: "handle-archived",
    };
    expect(await resolve(archived.publicId)).toEqual(archivedTarget);
    expect(await resolve("handle-archived-old")).toEqual(archivedTarget);
  });

  it("shows an archived product's page with nothing for sale (#88)", async () => {
    const { resolveProductHandle } = await import("./products");
    const { publicId } = await archived();

    const found = await resolveProductHandle(publicId, "uk", testDb.db);

    expect(found).toMatchObject({ kind: "product", available: false });
    if (found?.kind !== "product") throw new Error("not a product");
    expect(found.product.variants).toEqual([
      expect.objectContaining({ volumeMl: 30, stockQuantity: 0, inStock: false }),
    ]);
  });

  it("suggests listed perfumes like an archived one, sharing a family first (#88)", async () => {
    const { getProduct, getProductWithId, getSimilarProducts, SIMILAR_PRODUCTS_LIMIT } =
      await import("./products");
    const sauvage = sampleNamed("Sauvage");
    const found = await getProductWithId(sauvage.publicId, testDb.db);
    if (!found) throw new Error("no Sauvage");
    const { id, product } = found;

    const similar = await getSimilarProducts(id, product, testDb.db);

    expect(similar).toHaveLength(SIMILAR_PRODUCTS_LIMIT);
    expect(similar.map((p) => p.id)).not.toContain(product.id);
    expect(similar.every((p) => p.gender === "men" || p.gender === "unisex")).toBe(true);
    const first = await getProduct(similar[0]?.id ?? "", testDb.db);
    expect(first?.fragranceFamilies.some((f) => product.fragranceFamilies.includes(f))).toBe(true);
    expect(similar.map((p) => p.brand)).not.toContain(ARCHIVED_BRAND);
  });

  it("looks up product cards by public id, skipping unknown and unsold products", async () => {
    const { getProductSummaries } = await import("./products");
    const { products } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [unsold] = await testDb.db
      .select({ publicId: products.publicId })
      .from(products)
      .where(eq(products.brand, UNSOLD_BRAND));
    const coco = sampleNamed("Coco");
    const sauvage = sampleNamed("Sauvage");
    const unknown = "01a1652b-6e25-7fff-8000-000000000000";

    const found = await getProductSummaries(
      [sauvage.publicId, unknown, coco.publicId, unsold?.publicId ?? unknown, coco.publicId],
      testDb.db,
    );

    expect([...found.keys()].sort()).toEqual([coco.publicId, sauvage.publicId].sort());
    expect(found.get(coco.publicId)).toMatchObject({
      id: coco.publicId,
      title: coco.title,
      brand: coco.brand,
      minPrice: "990.00",
      hasPriceRange: true,
      volumes: [5, 10, 30, 50, 100],
      inStock: true,
      defaultVariant: { volumeMl: 5 },
    });
    expect(found.get(coco.publicId)?.variants.map((v) => v.volumeMl)).toEqual([5, 10, 30, 50, 100]);
  });

  it("doesn't query for an empty list of ids", async () => {
    const { getProductSummaries } = await import("./products");

    expect((await getProductSummaries([], testDb.db)).size).toBe(0);
  });

  it("hides an archived product from the catalog, its filters, its page, offers and the cart", async () => {
    const { checkVariantForCart, getProduct, getProductSummaries } = await import("./products");
    const { publicId, variantId } = await archived();

    const women = await catalog("women", { brand: ARCHIVED_BRAND });
    expect(women.products).toEqual([]);
    expect(women.filterOptions.brands).not.toContain(ARCHIVED_BRAND);
    expect(women.filterOptions.fragranceFamilies).not.toContain("archived-family");
    expect(await getProduct(publicId, testDb.db)).toBeNull();
    expect((await getProductSummaries([publicId], testDb.db)).size).toBe(0);
    expect(await checkVariantForCart(publicId, variantId, testDb.db)).toEqual({
      ok: false,
      error: "invalid-variant",
    });
  });
});
