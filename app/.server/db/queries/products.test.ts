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
