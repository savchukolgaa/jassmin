import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENDERS } from "~/lib/enums";
import { SAMPLE_PRODUCTS } from "./seed-data";
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
      expect(product.fragranceFamily).toBeTruthy();
    }
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

  it("inserts the sample products once", async () => {
    const { seedProducts } = await import("./seed");
    const { products } = await import("./schema");

    expect(await seedProducts(testDb.db)).toEqual({ inserted: SAMPLE_PRODUCTS.length });
    expect(await seedProducts(testDb.db)).toEqual({ inserted: 0 });
    expect(await testDb.db.$count(products)).toBe(SAMPLE_PRODUCTS.length);
  });
});
