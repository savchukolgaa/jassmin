import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("listSitemapProducts", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    const { productVariants, products } = await import("../schema");
    testDb = await createTestDatabase("jassmin_sitemap_products_test");
    await migrateLatest(testDb.db);

    const base = { brand: "Test", price: "100.00", volumeMl: 30 } as const;
    const rows = await testDb.db
      .insert(products)
      .values([
        { ...base, title: "Listed", gender: "women", slug: "listed" },
        { ...base, title: "Men's", gender: "men", slug: "mens" },
        { ...base, title: "Archived", gender: "women", slug: "archived", active: false },
        { ...base, title: "No sizes", gender: "women", slug: "no-sizes" },
        { ...base, title: "No slug", gender: "women", slug: null },
      ])
      .returning({ id: products.id, title: products.title });
    const withSizes = rows.filter((row) => row.title !== "No sizes");
    await testDb.db
      .insert(productVariants)
      .values(withSizes.map(({ id }) => ({ productId: id, volumeMl: 30, price: "100.00" })));
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  }, 30_000);

  it("lists only listed products with a size and a slug, by slug", async () => {
    const { listSitemapProducts } = await import("./products");

    const rows = await listSitemapProducts(testDb.db);

    expect(rows.map(({ slug, gender }) => [slug, gender])).toEqual([
      ["listed", "women"],
      ["mens", "men"],
    ]);
    for (const row of rows) {
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
  });
});

// Integration test (#140): one row per size of a listed, slugged product with a price.
describe.skipIf(!hasDatabase)("listFeedVariants", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    const { productVariants, products } = await import("../schema");
    testDb = await createTestDatabase("jassmin_feed_variants_test");
    await migrateLatest(testDb.db);

    const base = { brand: "Test", price: "100.00", volumeMl: 30, gender: "women" } as const;
    const rows = await testDb.db
      .insert(products)
      .values([
        { ...base, title: "Listed", slug: "listed" },
        { ...base, title: "Archived", slug: "archived", active: false },
        { ...base, title: "No slug", slug: null },
        { ...base, title: "Free", slug: "free" },
      ])
      .returning({ id: products.id, title: products.title });
    const id = (title: string) => {
      const row = rows.find((candidate) => candidate.title === title);
      if (!row) throw new Error(title);
      return row.id;
    };
    await testDb.db.insert(productVariants).values([
      // Inserted out of order: the query sorts by volume.
      {
        productId: id("Listed"),
        volumeMl: 10,
        price: "629.00",
        stockQuantity: 0,
        trackStock: true,
      },
      { productId: id("Listed"), volumeMl: 5, price: "329.00", stockQuantity: 0 },
      {
        productId: id("Listed"),
        volumeMl: 30,
        price: "1590.00",
        stockQuantity: 4,
        trackStock: true,
      },
      { productId: id("Archived"), volumeMl: 5, price: "100.00" },
      { productId: id("No slug"), volumeMl: 5, price: "100.00" },
      { productId: id("Free"), volumeMl: 5, price: "0.00" },
    ]);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  }, 30_000);

  it("lists each size of listed, slugged products with a price, by slug and volume", async () => {
    const { listFeedVariants, UNTRACKED_STOCK } = await import("./products");

    const rows = await listFeedVariants(testDb.db);

    expect(rows.map(({ slug, volumeMl, price, stock }) => [slug, volumeMl, price, stock])).toEqual([
      // Untracked: always in stock, whatever `stock_quantity` says (#98).
      ["listed", 5, "329.00", UNTRACKED_STOCK],
      ["listed", 10, "629.00", 0],
      ["listed", 30, "1590.00", 4],
    ]);
    const variantIds = new Set(rows.map((row) => row.variantId));
    expect(variantIds.size).toBe(3);
    expect(new Set(rows.map((row) => row.productId)).size).toBe(1);
  });
});
