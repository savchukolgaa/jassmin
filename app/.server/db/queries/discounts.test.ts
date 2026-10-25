import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("discount queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_discounts_queries_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { carts, discounts } = await import("../schema");
    await testDb.db.delete(carts);
    await testDb.db.delete(discounts);
  });

  async function insertDiscount(values: {
    slug: string;
    code?: string;
    active?: boolean;
    maxRedemptions?: number;
  }) {
    const { discounts } = await import("../schema");
    const [row] = await testDb.db
      .insert(discounts)
      .values({ kind: "percent", value: "10", ...values })
      .returning({ id: discounts.id });
    if (!row) throw new Error("no discount");
    return row.id;
  }

  it("finds a code whatever its case", async () => {
    const { findDiscountByCode } = await import("./discounts");
    const id = await insertDiscount({ slug: "welcome", code: "JASSMIN10" });

    expect((await findDiscountByCode(testDb.db, "jassmin10"))?.id).toBe(id);
    expect((await findDiscountByCode(testDb.db, "JASSMIN10"))?.value).toBe("10.00");
    expect(await findDiscountByCode(testDb.db, "NOPE")).toBeUndefined();
  });

  it("lists active automatic rules and the cart's own code, active or not", async () => {
    const { listCandidateDiscounts, lockCandidateDiscounts } = await import("./discounts");
    const trio = await insertDiscount({ slug: "trio" });
    await insertDiscount({ slug: "old-auto", active: false });
    await insertDiscount({ slug: "other-code", code: "OTHER" });
    const retired = await insertDiscount({ slug: "retired", code: "RETIRED", active: false });

    const ids = (rows: { id: number }[]) => rows.map((row) => row.id);
    expect(ids(await listCandidateDiscounts(testDb.db, null))).toEqual([trio]);
    expect(ids(await listCandidateDiscounts(testDb.db, retired))).toEqual([trio, retired]);
    await testDb.db.transaction(async (tx) => {
      expect(ids(await lockCandidateDiscounts(tx, retired))).toEqual([trio, retired]);
    });
  });

  it("redeems a code until its limit, never past it", async () => {
    const { redeemDiscount } = await import("./discounts");
    const { discounts } = await import("../schema");
    const limited = await insertDiscount({ slug: "limited", code: "TWICE", maxRedemptions: 2 });
    const unlimited = await insertDiscount({ slug: "unlimited", code: "ALWAYS" });

    expect(await redeemDiscount(testDb.db, limited)).toBe(true);
    expect(await redeemDiscount(testDb.db, limited)).toBe(true);
    expect(await redeemDiscount(testDb.db, limited)).toBe(false);
    for (let i = 0; i < 3; i++) {
      expect(await redeemDiscount(testDb.db, unlimited)).toBe(true);
    }

    const rows = await testDb.db
      .select({ id: discounts.id, count: discounts.redemptionCount })
      .from(discounts);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.count]))).toEqual({
      [limited]: 2,
      [unlimited]: 3,
    });
  });

  it("stores and clears the cart's promo code", async () => {
    const { findCartDiscountId, setCartDiscount } = await import("./discounts");
    const { carts } = await import("../schema");
    const id = await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
    const [cart] = await testDb.db.insert(carts).values({}).returning({ id: carts.id });
    if (!cart) throw new Error("no cart");

    expect(await findCartDiscountId(testDb.db, cart.id)).toBeNull();
    await setCartDiscount(testDb.db, cart.id, id);
    expect(await findCartDiscountId(testDb.db, cart.id)).toBe(id);
    await setCartDiscount(testDb.db, cart.id, null);
    expect(await findCartDiscountId(testDb.db, cart.id)).toBeNull();
  });
});
