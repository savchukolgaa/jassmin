import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_PRICES } from "./catalog-prices";
import { hasDatabase, type TestDatabase } from "./test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("applyCatalogPrices", () => {
  let testDb: TestDatabase;
  /** Product ids by name. */
  const ids = new Map<string, number>();

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    const { products, productVariants } = await import("./schema");
    testDb = await createTestDatabase("jassmin_apply_catalog_prices_test");
    await migrateLatest(testDb.db);

    const product = async (
      name: string,
      extra: { active?: boolean; packSize?: number; price?: string; volumeMl?: number } = {},
    ) => {
      const [row] = await testDb.db
        .insert(products)
        .values({
          title: name,
          brand: "Test",
          gender: "women",
          price: extra.price ?? "300.00",
          volumeMl: extra.volumeMl ?? 10,
          active: extra.active ?? true,
          packSize: extra.packSize ?? 1,
        })
        .returning({ id: products.id });
      if (!row) throw new Error(`No ${name}`);
      ids.set(name, row.id);
      return row.id;
    };

    // Two sizes: 10 ml at an old price, 50 ml at the right one with tracked stock.
    const partial = await product("partial");
    // Already on the table, legacy columns included: nothing to do.
    const complete = await product("complete", { price: "119.00", volumeMl: 5 });
    const archived = await product("archived", { active: false });
    const set = await product("set", { packSize: 3, price: "990.00" });
    await testDb.db.insert(productVariants).values([
      { productId: partial, volumeMl: 10, price: "300.00", stockQuantity: 2 },
      { productId: partial, volumeMl: 50, price: "629.00", stockQuantity: 4, trackStock: true },
      ...Object.entries(CATALOG_PRICES).map(([volume, price]) => ({
        productId: complete,
        volumeMl: Number(volume),
        price: price ?? "0",
      })),
      { productId: archived, volumeMl: 10, price: "300.00" },
      { productId: set, volumeMl: 10, price: "990.00", stockQuantity: 20 },
    ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  /** A product's sizes as `[volume, price, stock, tracked]`, smallest first. */
  async function sizesOf(name: string) {
    const { asc, eq } = await import("drizzle-orm");
    const { productVariants } = await import("./schema");
    const rows = await testDb.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, ids.get(name) ?? 0))
      .orderBy(asc(productVariants.volumeMl));
    return rows.map((v) => [v.volumeMl, v.price, v.stockQuantity, v.trackStock]);
  }

  async function productOf(name: string) {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("./schema");
    const [row] = await testDb.db
      .select()
      .from(products)
      .where(eq(products.id, ids.get(name) ?? 0));
    if (!row) throw new Error(`No ${name}`);
    return row;
  }

  async function outbox() {
    const { cmsOutbox } = await import("./schema");
    const rows = await testDb.db
      .select({ entityId: cmsOutbox.entityId, version: cmsOutbox.version })
      .from(cmsOutbox);
    return rows.sort((a, b) => a.entityId - b.entityId);
  }

  it("puts every active perfume on the standard sizes and prices, and archives sets", async () => {
    const { applyCatalogPrices } = await import("./apply-catalog-prices");
    const completeBefore = await productOf("complete");

    expect(await applyCatalogPrices(testDb.db, CATALOG_PRICES)).toEqual({
      setsArchived: 1,
      productsChanged: 1,
      variantsInserted: 3,
      pricesUpdated: 1,
      variantsDeleted: 0,
      queued: 2,
    });

    expect(await sizesOf("partial")).toEqual([
      [5, "119.00", 0, false],
      [10, "240.00", 2, false],
      [30, "459.00", 0, false],
      // The tracked size keeps its stock and its tracking.
      [50, "629.00", 4, true],
      [100, "969.00", 0, false],
    ]);
    // The deprecated columns follow the smallest size, like `productWrite`.
    expect(await productOf("partial")).toMatchObject({
      price: "119.00",
      volumeMl: 5,
      stockQuantity: 0,
    });
    expect((await productOf("complete")).updatedAt).toEqual(completeBefore.updatedAt);
    expect(await sizesOf("archived")).toEqual([[10, "300.00", 0, false]]);
    expect(await productOf("set")).toMatchObject({ active: false });
    expect(await sizesOf("set")).toEqual([[10, "990.00", 20, false]]);
    expect((await outbox()).map((row) => row.entityId)).toEqual(
      [ids.get("partial"), ids.get("set")].sort((a = 0, b = 0) => a - b),
    );
  });

  it("changes nothing the second time", async () => {
    const { applyCatalogPrices } = await import("./apply-catalog-prices");
    const queued = await outbox();
    const partial = await productOf("partial");

    expect(await applyCatalogPrices(testDb.db, CATALOG_PRICES)).toEqual({
      setsArchived: 0,
      productsChanged: 0,
      variantsInserted: 0,
      pricesUpdated: 0,
      variantsDeleted: 0,
      queued: 0,
    });
    expect(await outbox()).toEqual(queued);
    expect((await productOf("partial")).updatedAt).toEqual(partial.updatedAt);
  });

  it("deletes sizes outside the table and refuses an empty table", async () => {
    const { applyCatalogPrices } = await import("./apply-catalog-prices");

    // A shorter table: 30 and 100 ml are no longer sold.
    const result = await applyCatalogPrices(testDb.db, {
      5: "119.00",
      10: "240.00",
      50: "629.00",
    });

    expect(result).toMatchObject({ variantsDeleted: 4, productsChanged: 2, queued: 2 });
    expect((await sizesOf("partial")).map(([volume]) => volume)).toEqual([5, 10, 50]);
    await expect(applyCatalogPrices(testDb.db, {})).rejects.toThrow(/no sizes/);
  });
});
