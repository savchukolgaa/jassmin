import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ABANDONED_CART_HOURS, parseAbandonedCartHours } from "./abandoned-carts";
import { hasDatabase, type TestDatabase } from "./test-utils";

describe("parseAbandonedCartHours", () => {
  it("defaults to 24 hours when unset or empty", () => {
    expect(DEFAULT_ABANDONED_CART_HOURS).toBe(24);
    expect(parseAbandonedCartHours({})).toEqual({ ok: true, hours: 24 });
    expect(parseAbandonedCartHours({ ABANDONED_CART_HOURS: "" })).toEqual({ ok: true, hours: 24 });
  });

  it("accepts a positive whole number", () => {
    expect(parseAbandonedCartHours({ ABANDONED_CART_HOURS: "6" })).toEqual({ ok: true, hours: 6 });
  });

  it("rejects anything else", () => {
    for (const value of ["0", "-1", "1.5", "abc"]) {
      expect(parseAbandonedCartHours({ ABANDONED_CART_HOURS: value })).toEqual({
        ok: false,
        error: `ABANDONED_CART_HOURS must be a positive whole number of hours, got "${value}".`,
      });
    }
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("markAbandonedCartsJob", () => {
  let testDb: TestDatabase;
  let variantId = 0;
  let productId = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    const { seedProducts } = await import("./seed");
    const { productVariants } = await import("./schema");
    testDb = await createTestDatabase("jassmin_abandoned_carts_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    const [variant] = await testDb.db.select().from(productVariants).limit(1);
    variantId = variant?.id ?? 0;
    productId = variant?.productId ?? 0;
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { carts } = await import("./schema");
    await testDb.db.delete(carts);
  });

  /** A guest cart last touched `hoursAgo` hours ago, with one line unless `empty`. */
  async function cartIdle(
    hoursAgo: number,
    { status = "active", empty = false }: { status?: "active" | "converted"; empty?: boolean } = {},
  ) {
    const { sql } = await import("drizzle-orm");
    const { cartItems, carts } = await import("./schema");
    const [cart] = await testDb.db.insert(carts).values({ status }).returning();
    const id = cart?.id ?? 0;
    if (!empty) {
      await testDb.db.insert(cartItems).values({ cartId: id, productId, variantId });
    }
    // Last, so the line insert can't move it.
    await testDb.db.execute(
      sql`update carts set updated_at = now() - make_interval(hours => ${hoursAgo}) where id = ${id}`,
    );
    return id;
  }

  async function cartRow(id: number) {
    const { eq } = await import("drizzle-orm");
    const { carts } = await import("./schema");
    const [row] = await testDb.db.select().from(carts).where(eq(carts.id, id));
    return row;
  }

  it("abandons stale carts with lines and keeps updated_at as the last activity", async () => {
    const { markAbandonedCartsJob } = await import("./abandoned-carts");
    const stale = await cartIdle(30);
    const before = await cartRow(stale);

    const result = await markAbandonedCartsJob(testDb.db, 24);

    expect(result).toEqual({
      updated: 1,
      message: "Marked 1 cart inactive for more than 24 h as abandoned.",
    });
    const after = await cartRow(stale);
    expect(after?.status).toBe("abandoned");
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.abandonedAt).toBeInstanceOf(Date);
    expect(Math.abs((after?.abandonedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  it("leaves empty, converted and recent carts alone", async () => {
    const { markAbandonedCartsJob } = await import("./abandoned-carts");
    const empty = await cartIdle(30, { empty: true });
    const converted = await cartIdle(30, { status: "converted" });
    const recent = await cartIdle(1);

    expect((await markAbandonedCartsJob(testDb.db, 24)).updated).toBe(0);

    expect(await cartRow(empty)).toMatchObject({ status: "active", abandonedAt: null });
    expect(await cartRow(converted)).toMatchObject({ status: "converted", abandonedAt: null });
    expect(await cartRow(recent)).toMatchObject({ status: "active", abandonedAt: null });
  });

  it("uses the configured threshold", async () => {
    const { markAbandonedCartsJob } = await import("./abandoned-carts");
    const sevenHours = await cartIdle(7);

    expect((await markAbandonedCartsJob(testDb.db, 24)).updated).toBe(0);
    expect((await cartRow(sevenHours))?.status).toBe("active");

    expect((await markAbandonedCartsJob(testDb.db, 6)).updated).toBe(1);
    expect((await cartRow(sevenHours))?.status).toBe("abandoned");
  });

  it("is idempotent", async () => {
    const { markAbandonedCartsJob } = await import("./abandoned-carts");
    const stale = await cartIdle(48);
    await markAbandonedCartsJob(testDb.db, 24);
    const first = await cartRow(stale);

    expect(await markAbandonedCartsJob(testDb.db, 24)).toEqual({
      updated: 0,
      message: "Marked 0 carts inactive for more than 24 h as abandoned.",
    });
    expect(await cartRow(stale)).toEqual(first);
  });
});
