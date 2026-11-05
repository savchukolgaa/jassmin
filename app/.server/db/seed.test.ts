import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAGRANCE_FAMILIES, GENDERS, PERFUME_VOLUMES_ML } from "~/lib/enums";
import { SAMPLE_DISCOUNTS, SAMPLE_PRODUCTS } from "./seed-data";
import { hasDatabase, type TestDatabase } from "./test-utils";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("SAMPLE_PRODUCTS", () => {
  it("covers every gender", () => {
    expect(new Set(SAMPLE_PRODUCTS.map((p) => p.gender))).toEqual(new Set(GENDERS));
  });

  it("includes a set of three testers", () => {
    expect(SAMPLE_PRODUCTS.some((p) => p.packSize === 3)).toBe(true);
  });

  it("has valid prices, volumes, pack sizes and stock", () => {
    for (const product of SAMPLE_PRODUCTS) {
      expect(product.price).toMatch(/^\d{1,8}\.\d{2}$/);
      expect(product.volumeMl).toBeGreaterThan(0);
      expect(product.packSize ?? 1).toBeGreaterThanOrEqual(1);
      expect(product.stockQuantity ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every perfume its families and notes; sets may have none", () => {
    for (const product of SAMPLE_PRODUCTS) {
      for (const family of product.fragranceFamilies) {
        expect(FRAGRANCE_FAMILIES).toContain(family);
      }
      expect(new Set(product.fragranceFamilies).size).toBe(product.fragranceFamilies.length);
      if ((product.packSize ?? 1) === 1) {
        expect(product.fragranceFamilies.length).toBeGreaterThan(0);
        expect(product.notes?.length).toBeGreaterThan(0);
      }
    }
  });

  it("sells each product in unique allowed sizes with valid prices and stock", () => {
    for (const product of SAMPLE_PRODUCTS) {
      const volumes = product.variants.map((v) => v.volumeMl);

      expect(volumes.length).toBeGreaterThan(0);
      expect(new Set(volumes).size).toBe(volumes.length);
      for (const variant of product.variants) {
        expect(PERFUME_VOLUMES_ML).toContain(variant.volumeMl);
        expect(variant.price).toMatch(/^\d{1,8}\.\d{2}$/);
        expect(variant.stockQuantity).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("repeats the legacy size as one of the variants", () => {
    for (const product of SAMPLE_PRODUCTS) {
      expect(product.variants).toContainEqual({
        volumeMl: product.volumeMl,
        price: product.price,
        stockQuantity: product.stockQuantity ?? 0,
      });
    }
  });

  it("includes several sizes, sold-out sizes and a sold-out product", () => {
    const inStock = (p: (typeof SAMPLE_PRODUCTS)[number]) =>
      p.variants.filter((v) => v.stockQuantity > 0).length;

    expect(SAMPLE_PRODUCTS.filter((p) => p.variants.length > 2).length).toBeGreaterThan(3);
    expect(SAMPLE_PRODUCTS.some((p) => inStock(p) > 0 && inStock(p) < p.variants.length)).toBe(
      true,
    );
    expect(SAMPLE_PRODUCTS.some((p) => inStock(p) === 0)).toBe(true);
  });

  it("has the tester trio and the couple offer as the automatic discounts (#59, #124)", () => {
    const automatic = SAMPLE_DISCOUNTS.filter((discount) => !discount.code);
    expect(automatic).toEqual([
      expect.objectContaining({
        slug: "tester-trio",
        kind: "fixed_price_set",
        value: "499.00",
        scopeVolumesMl: [10],
        scopePackSize: 1,
        minQuantity: 3,
        maxSets: 3,
      }),
      expect.objectContaining({
        slug: "couple-15",
        kind: "percent_every_nth",
        value: "15.00",
        scopeVolumesMl: [30, 50, 100],
        scopePackSize: 1,
        minQuantity: 2,
      }),
    ]);
    const slugs = SAMPLE_DISCOUNTS.map((discount) => discount.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a unique UUID v7 publicId per product", () => {
    const ids = SAMPLE_PRODUCTS.map((p) => p.publicId);

    for (const id of ids) {
      expect(id).toMatch(UUID_V7);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("seedProducts", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_seed_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  const VARIANT_COUNT = SAMPLE_PRODUCTS.reduce((sum, p) => sum + p.variants.length, 0);

  it("inserts the sample products and their sizes once", async () => {
    const { seedProducts } = await import("./seed");
    const { productVariants, products } = await import("./schema");

    expect(await seedProducts(testDb.db)).toEqual({
      inserted: SAMPLE_PRODUCTS.length,
      variantsInserted: VARIANT_COUNT,
    });
    expect(await seedProducts(testDb.db)).toEqual({ inserted: 0, variantsInserted: 0 });
    expect(await testDb.db.$count(products)).toBe(SAMPLE_PRODUCTS.length);
    expect(await testDb.db.$count(productVariants)).toBe(VARIANT_COUNT);
  });

  it("adds missing sizes to products that already exist", async () => {
    const { seedProducts } = await import("./seed");
    const { productVariants } = await import("./schema");
    const { inArray } = await import("drizzle-orm");

    await testDb.db.delete(productVariants).where(inArray(productVariants.volumeMl, [5, 10]));
    const missing = VARIANT_COUNT - (await testDb.db.$count(productVariants));

    expect(missing).toBeGreaterThan(0);
    expect(await seedProducts(testDb.db)).toEqual({ inserted: 0, variantsInserted: missing });
    expect(await testDb.db.$count(productVariants)).toBe(VARIANT_COUNT);
  });

  it("stores the families with the primary first and fills them in for older sample rows", async () => {
    const { seedProducts } = await import("./seed");
    const { products } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    const [sample] = SAMPLE_PRODUCTS.filter((p) => p.fragranceFamilies.length > 1);
    if (!sample) throw new Error("A sample product needs several families");
    const stored = () =>
      testDb.db
        .select({
          fragranceFamily: products.fragranceFamily,
          fragranceFamilies: products.fragranceFamilies,
          notes: products.notes,
        })
        .from(products)
        .where(eq(products.publicId, sample.publicId));

    const expected = {
      fragranceFamily: sample.fragranceFamilies[0],
      fragranceFamilies: sample.fragranceFamilies,
      notes: sample.notes,
    };
    expect(await stored()).toEqual([expected]);

    // A row seeded before #65: only the primary family, no notes.
    await testDb.db
      .update(products)
      .set({ fragranceFamilies: [sample.fragranceFamilies[0] ?? ""], notes: [] })
      .where(eq(products.publicId, sample.publicId));
    await seedProducts(testDb.db);
    expect(await stored()).toEqual([expected]);
  });

  it("inserts the sample discount rules once and keeps their redemption counts", async () => {
    const { seedDiscounts } = await import("./seed");
    const { discounts } = await import("./schema");
    const { eq } = await import("drizzle-orm");

    // Migrations 0021 and 0022 already created the tester trio (#98) and the couple offer
    // (#124); the seed adds the others.
    expect(await seedDiscounts(testDb.db)).toBe(SAMPLE_DISCOUNTS.length - 2);
    await testDb.db
      .update(discounts)
      .set({ redemptionCount: 7 })
      .where(eq(discounts.slug, "tester-trio"));
    expect(await seedDiscounts(testDb.db)).toBe(0);
    expect(await testDb.db.$count(discounts)).toBe(SAMPLE_DISCOUNTS.length);
    const [trio] = await testDb.db
      .select({ count: discounts.redemptionCount })
      .from(discounts)
      .where(eq(discounts.slug, "tester-trio"));
    expect(trio?.count).toBe(7);
  });
});
