import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toKopiyky } from "~/lib/money";
import { CATALOG_PRICES } from "./catalog-prices";
import { SAMPLE_DISCOUNTS } from "./seed-data";
import { hasDatabase, type TestDatabase } from "./test-utils";

const TEN_ML = CATALOG_PRICES[10];

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("tester trio rule (#98)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_tester_trio_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function trio() {
    const { findDiscountBySlug } = await import("./queries/discounts");
    const { TESTER_TRIO_DISCOUNT_SLUG } = await import("~/lib/discounts");
    const rule = await findDiscountBySlug(testDb.db, TESTER_TRIO_DISCOUNT_SLUG);
    if (!rule) throw new Error("No tester trio after the migrations");
    return rule;
  }

  it("is created by the migrations exactly as the seed defines it", async () => {
    const seeded = SAMPLE_DISCOUNTS.find((d) => d.slug === "tester-trio");
    const rule = await trio();

    expect(rule).toMatchObject({
      kind: seeded?.kind,
      value: seeded?.value,
      scopeVolumesMl: seeded?.scopeVolumesMl,
      scopePackSize: seeded?.scopePackSize,
      minQuantity: seeded?.minQuantity,
      maxSets: seeded?.maxSets,
      code: null,
    });
  });

  it("costs less than buying its testers at the standard price, so the home page tells the truth", async () => {
    const { priceCart } = await import("../services/pricing");
    const { toTrioOffer } = await import("../services/trio");
    if (!TEN_ML) throw new Error("The price table has no 10 ml size");
    const rule = await trio();
    const now = new Date();

    // The home page advertises it…
    expect(toTrioOffer(rule, now)).toEqual({
      price: rule.value,
      setSize: rule.minQuantity,
      volumeMl: 10,
    });
    expect(toKopiyky(rule.value)).toBeLessThan(rule.minQuantity * toKopiyky(TEN_ML));

    // …and the cart gives exactly that price for three different 10 ml perfumes.
    const lines = ["a", "b", "c"].map((id) => ({
      productPublicId: id,
      volumeMl: 10,
      packSize: 1,
      unitPrice: toKopiyky(TEN_ML),
      quantity: 1,
    }));
    const priced = priceCart(lines, [rule], now);
    expect(priced.applied?.discountId).toBe(rule.id);
    expect(priced.total).toBe(toKopiyky(rule.value));
    expect(priced.discount).toBe(3 * toKopiyky(TEN_ML) - toKopiyky(rule.value));
  });
});
