import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("product slug history queries", () => {
  let testDb: TestDatabase;
  let first: number;
  let second: number;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    const { products } = await import("../schema");
    testDb = await createTestDatabase("jassmin_product_slugs_test");
    await migrateLatest(testDb.db);
    const rows = await testDb.db
      .insert(products)
      .values([
        { title: "One", brand: "B", gender: "women", price: "1.00", volumeMl: 10 },
        { title: "Two", brand: "B", gender: "men", price: "1.00", volumeMl: 10 },
      ])
      .returning({ id: products.id });
    first = rows[0]?.id ?? 0;
    second = rows[1]?.id ?? 0;
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { productSlugHistory } = await import("../schema");
    await testDb.db.delete(productSlugHistory);
  });

  it("finds the product an old slug belonged to", async () => {
    const { findProductIdBySlugHistory, recordOldSlug } = await import("./product-slugs");

    await recordOldSlug(testDb.db, first, "old-one");

    expect(await findProductIdBySlugHistory(testDb.db, "old-one")).toBe(first);
    expect(await findProductIdBySlugHistory(testDb.db, "never")).toBeUndefined();
  });

  it("moves an old slug to the product that had it last", async () => {
    const { findProductIdBySlugHistory, recordOldSlug } = await import("./product-slugs");

    await recordOldSlug(testDb.db, first, "shared");
    await recordOldSlug(testDb.db, second, "shared");

    expect(await findProductIdBySlugHistory(testDb.db, "shared")).toBe(second);
  });

  it("forgets a slug", async () => {
    const { findProductIdBySlugHistory, forgetSlug, recordOldSlug } = await import(
      "./product-slugs"
    );

    await recordOldSlug(testDb.db, first, "taken-again");
    await forgetSlug(testDb.db, "taken-again");
    await forgetSlug(testDb.db, "not-there");

    expect(await findProductIdBySlugHistory(testDb.db, "taken-again")).toBeUndefined();
  });
});
