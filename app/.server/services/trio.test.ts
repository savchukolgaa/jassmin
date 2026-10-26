import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import type { PricingDiscount } from "./pricing";
import { toTrioOffer } from "./trio";

const NOW = new Date("2026-10-26T12:00:00Z");

/** The seeded tester trio: any three single 10 ml units for 499 ₴, at most three sets. */
function trio(overrides: Partial<PricingDiscount> = {}): PricingDiscount {
  return {
    id: 1,
    code: null,
    kind: "fixed_price_set",
    value: "499.00",
    scopeVolumesMl: [10],
    scopeProductPublicIds: null,
    scopePackSize: 1,
    minQuantity: 3,
    maxSets: 3,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    active: true,
    ...overrides,
  };
}

describe("toTrioOffer", () => {
  it("advertises the live rule's set price, size and tester volume", () => {
    expect(toTrioOffer(trio(), NOW)).toEqual({ price: "499.00", setSize: 3, volumeMl: 10 });
    expect(toTrioOffer(trio({ scopeVolumesMl: null }), NOW)?.volumeMl).toBeNull();
  });

  it("is null when checkout wouldn't apply the rule", () => {
    expect(toTrioOffer(undefined, NOW)).toBeNull();
    expect(toTrioOffer(trio({ active: false }), NOW)).toBeNull();
    expect(toTrioOffer(trio({ kind: "percent" }), NOW)).toBeNull();
    expect(toTrioOffer(trio({ startsAt: new Date("2026-10-27T00:00:00Z") }), NOW)).toBeNull();
    expect(toTrioOffer(trio({ endsAt: NOW }), NOW)).toBeNull();
    expect(toTrioOffer(trio({ maxRedemptions: 5, redemptionCount: 5 }), NOW)).toBeNull();
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("getTesterTrioOffer", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_trio_offer_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { discounts } = await import("../db/schema");
    await testDb.db.delete(discounts);
  });

  it("reads the tester-trio rule by its slug", async () => {
    const { discounts } = await import("../db/schema");
    const { getTesterTrioOffer } = await import("./trio");
    await testDb.db.insert(discounts).values([
      { slug: "welcome-10", code: "JASSMIN10", kind: "percent", value: "10.00" },
      {
        slug: "tester-trio",
        kind: "fixed_price_set",
        value: "449.00",
        scopeVolumesMl: [10],
        scopePackSize: 1,
        minQuantity: 3,
        maxSets: 3,
      },
    ]);

    expect(await getTesterTrioOffer(NOW, testDb.db)).toEqual({
      price: "449.00",
      setSize: 3,
      volumeMl: 10,
    });
  });

  it("is null without the rule or once it's switched off", async () => {
    const { discounts } = await import("../db/schema");
    const { getTesterTrioOffer } = await import("./trio");
    expect(await getTesterTrioOffer(NOW, testDb.db)).toBeNull();

    await testDb.db.insert(discounts).values({
      slug: "tester-trio",
      kind: "fixed_price_set",
      value: "499.00",
      minQuantity: 3,
      active: false,
    });
    expect(await getTesterTrioOffer(NOW, testDb.db)).toBeNull();
  });
});
