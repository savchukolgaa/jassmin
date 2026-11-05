import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COUPLE_OFFER_DISCOUNT_SLUG } from "~/lib/discounts";
import { toKopiyky } from "~/lib/money";
import { CATALOG_PRICES } from "./catalog-prices";
import { SAMPLE_DISCOUNTS } from "./seed-data";
import { hasDatabase, type TestDatabase } from "./test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("couple offer rule (#124)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_couple_offer_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function couple() {
    const { findDiscountBySlug } = await import("./queries/discounts");
    const rule = await findDiscountBySlug(testDb.db, COUPLE_OFFER_DISCOUNT_SLUG);
    if (!rule) throw new Error("No couple offer after the migrations");
    return rule;
  }

  it("is created by the migrations exactly as the seed defines it", async () => {
    const seeded = SAMPLE_DISCOUNTS.find((d) => d.slug === COUPLE_OFFER_DISCOUNT_SLUG);
    const rule = await couple();

    expect(rule).toMatchObject({
      kind: seeded?.kind,
      value: seeded?.value,
      scopeVolumesMl: seeded?.scopeVolumesMl,
      scopePackSize: seeded?.scopePackSize,
      minQuantity: seeded?.minQuantity,
      maxSets: null,
      code: null,
    });
  });

  it("takes the 15% the discount line and the offers page advertise off the second bottle", async () => {
    const { priceCart } = await import("../services/pricing");
    const fifty = CATALOG_PRICES[50];
    const hundred = CATALOG_PRICES[100];
    if (!fifty || !hundred) throw new Error("The price table has no 50 or 100 ml size");
    const rule = await couple();

    // `checkout.discountCouple` and the Strapi couple-offer texts say 15%.
    expect(rule.value).toBe("15.00");

    const bottle = (id: string, price: string, volumeMl: number) => ({
      productPublicId: id,
      volumeMl,
      packSize: 1,
      unitPrice: toKopiyky(price),
      quantity: 1,
    });
    const priced = priceCart(
      [bottle("a", hundred, 100), bottle("b", fifty, 50)],
      [rule],
      new Date(),
    );
    expect(priced.applied?.discountId).toBe(rule.id);
    expect(priced.discount).toBe(Math.floor((toKopiyky(fifty) * 15) / 100));
  });
});
