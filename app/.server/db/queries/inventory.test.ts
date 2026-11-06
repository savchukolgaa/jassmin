import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CheckoutInput } from "~/lib/checkout";
import type { CmsProductFields } from "~/lib/cms-sync";
import { hasDatabase, type TestDatabase } from "../test-utils";

const customer: CheckoutInput = {
  fullName: "Олена Коваль",
  email: "olena@example.com",
  phone: "+380671234567",
  city: "Київ",
  branch: "Відділення №12",
  paymentMethod: "cod",
};

const fields: Omit<CmsProductFields, "variants"> = {
  name: "Ledger Test",
  slug: "ledger-test",
  brand: "Test",
  description: null,
  descriptionEn: null,
  gender: "women",
  fragranceFamilies: ["квіткові"],
  notes: [],
  storeCode: null,
  popularRank: null,
  imageUrl: null,
  imageWidth: null,
  imageHeight: null,
  imageFormats: null,
  packSize: 1,
  active: true,
};

beforeAll(() => {
  // `services/cart` imports the auth session, which validates the env on import.
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Integration test (#130): runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("inventory ledger", () => {
  let testDb: TestDatabase;
  let slugCounter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_inventory_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  /** A product created in Strapi with a tracked 30 ml size (`stock` units) and an untracked 10 ml. */
  async function product(stock: number) {
    const { applyCmsProductChange } = await import("../../services/cms-sync");
    const { and, eq } = await import("drizzle-orm");
    const { productVariants, products } = await import("../schema");
    slugCounter += 1;
    const slug = `ledger-test-${slugCounter}`;
    const variants: CmsProductFields["variants"] = [
      { volumeMl: 30, price: "500.00", trackStock: true, stock },
      { volumeMl: 10, price: "200.00", trackStock: false, stock: 0 },
    ];
    const result = await applyCmsProductChange(
      { action: "create", ...fields, slug, variants },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);
    const [size] = await testDb.db
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.publicId, result.product.publicId), eq(productVariants.volumeMl, 30)));
    if (!size) throw new Error("no size");
    const update = (stockNow: number, typed: number, stockReason: "adjustment" | "receipt") =>
      applyCmsProductChange(
        {
          action: "update",
          ...fields,
          publicId: result.product.publicId,
          slug,
          variants: [
            {
              volumeMl: 30,
              price: "500.00",
              trackStock: true,
              stock: typed,
              expectedStock: stockNow,
              stockReason,
            },
            { volumeMl: 10, price: "200.00", trackStock: false, stock: 0 },
          ],
        },
        testDb.db,
      );
    return { ...size, update };
  }

  /** Places a cash-on-delivery order for `quantity` units of the size. */
  async function order(size: { id: number; productId: number }, quantity: number) {
    const { createOrder } = await import("../../services/orders");
    const { cartItems, carts, sessions } = await import("../schema");
    const [session] = await testDb.db
      .insert(sessions)
      .values({ anonymousId: crypto.randomUUID() })
      .returning();
    const [cart] = await testDb.db
      .insert(carts)
      .values({ sessionId: session?.sessionId })
      .returning();
    if (!cart) throw new Error("no cart");
    await testDb.db
      .insert(cartItems)
      .values({ cartId: cart.id, productId: size.productId, variantId: size.id, quantity });
    return createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db);
  }

  /** Tracked sizes whose ledger doesn't add up to their stock. */
  async function drift() {
    const { sql } = await import("drizzle-orm");
    const result = await testDb.db.execute(
      sql`select v.id, v.stock_quantity, coalesce(sum(m.quantity_delta), 0)::int as ledger
          from product_variants v left join inventory_movements m on m.variant_id = v.id
          where v.track_stock group by v.id
          having v.stock_quantity <> coalesce(sum(m.quantity_delta), 0)`,
    );
    return result.rows;
  }

  it("adds up to the stock through checkout, cancel, return and Strapi edits", async () => {
    const { applyCmsOrderChange } = await import("../../services/cms-sync");
    const { listInventoryMovements } = await import("./inventory");
    const size = await product(5);

    const cancelled = await order(size, 2);
    const returned = await order(size, 1);
    if (!cancelled.ok || !returned.ok) throw new Error("not placed");
    await applyCmsOrderChange(
      cancelled.orderId,
      { status: "cancelled", cancelReason: "customer_request" },
      testDb.db,
    );
    await applyCmsOrderChange(returned.orderId, { status: "shipped" }, testDb.db);
    await applyCmsOrderChange(returned.orderId, { status: "unclaimed" }, testDb.db);
    expect(await size.update(5, 8, "receipt")).toMatchObject({ ok: true });
    expect(await size.update(8, 7, "adjustment")).toMatchObject({ ok: true });

    expect(
      (await listInventoryMovements(testDb.db, size.id)).map((m) => [
        m.reason,
        m.quantityDelta,
        m.stockAfter,
        m.source,
      ]),
    ).toEqual([
      ["opening_balance", 5, 5, "cms"],
      ["sale", -2, 3, "checkout"],
      ["sale", -1, 2, "checkout"],
      ["cancellation", 2, 4, "cms"],
      ["return", 1, 5, "cms"],
      ["receipt", 3, 8, "cms"],
      ["adjustment", -1, 7, "cms"],
    ]);
    expect(await drift()).toEqual([]);
  });

  it("stays equal to the stock under concurrent checkouts", async () => {
    const { listInventoryMovements } = await import("./inventory");
    const size = await product(5);

    const results = await Promise.all(Array.from({ length: 7 }, () => order(size, 1)));

    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const sales = (await listInventoryMovements(testDb.db, size.id)).filter(
      (m) => m.reason === "sale",
    );
    // Each sale saw the stock the previous one left: 4, 3, 2, 1, 0 in ledger order.
    expect(sales.map((m) => m.stockAfter)).toEqual([4, 3, 2, 1, 0]);
    expect(await drift()).toEqual([]);
  });

  describe("inventory_daily", () => {
    /** A tracked size with these movements, written as they happened at `at` (ISO, UTC). */
    async function sizeWithHistory(
      movements: { at: string; reason: "opening_balance" | "sale" | "receipt"; delta: number }[],
    ) {
      const { productVariants, products } = await import("../schema");
      const { insertInventoryMovements } = await import("./inventory");
      const [row] = await testDb.db
        .insert(products)
        .values({ title: "Daily", brand: "Test", gender: "men", price: "100.00", volumeMl: 50 })
        .returning({ id: products.id });
      let stock = 0;
      for (const m of movements) stock += m.delta;
      const [size] = await testDb.db
        .insert(productVariants)
        .values({
          productId: row?.id ?? 0,
          volumeMl: 50,
          price: "100.00",
          stockQuantity: stock,
          trackStock: true,
        })
        .returning({ id: productVariants.id });
      const variantId = size?.id ?? 0;
      let after = 0;
      for (const m of movements) {
        after += m.delta;
        await insertInventoryMovements(testDb.db, [
          {
            variantId,
            reason: m.reason,
            quantityDelta: m.delta,
            stockAfter: after,
            source: "job",
            occurredAt: new Date(m.at),
          },
        ]);
      }
      return variantId;
    }

    it("gives units sold, closing stock and stock-out days, in Kyiv days", async () => {
      const { listInventoryDays } = await import("./inventory");
      // October 2026 is UTC+3 in Kyiv.
      const variantId = await sizeWithHistory([
        { at: "2026-10-01T07:00:00Z", reason: "opening_balance", delta: 2 },
        { at: "2026-10-02T07:00:00Z", reason: "sale", delta: -1 },
        { at: "2026-10-02T12:00:00Z", reason: "sale", delta: -1 },
        // 3 October: nothing happens; the shelf is empty all day.
        { at: "2026-10-04T06:00:00Z", reason: "receipt", delta: 5 },
        { at: "2026-10-04T10:00:00Z", reason: "sale", delta: -2 },
        // 22:30 UTC on the 5th is 01:30 on the 6th in Kyiv.
        { at: "2026-10-05T22:30:00Z", reason: "sale", delta: -1 },
      ]);

      expect(await listInventoryDays(testDb.db, variantId, "2026-10-01", "2026-10-07")).toEqual([
        { variantId, day: "2026-10-01", unitsSold: 0, closingStock: 2, wasOutOfStock: false },
        { variantId, day: "2026-10-02", unitsSold: 2, closingStock: 0, wasOutOfStock: true },
        { variantId, day: "2026-10-03", unitsSold: 0, closingStock: 0, wasOutOfStock: true },
        // Empty until the delivery that morning: censored demand.
        { variantId, day: "2026-10-04", unitsSold: 2, closingStock: 3, wasOutOfStock: true },
        { variantId, day: "2026-10-05", unitsSold: 0, closingStock: 3, wasOutOfStock: false },
        { variantId, day: "2026-10-06", unitsSold: 1, closingStock: 2, wasOutOfStock: false },
        { variantId, day: "2026-10-07", unitsSold: 0, closingStock: 2, wasOutOfStock: false },
      ]);
    });

    it("runs to today and leaves out sizes that don't track stock now", async () => {
      const { eq, sql } = await import("drizzle-orm");
      const { productVariants } = await import("../schema");
      const { listInventoryDays } = await import("./inventory");
      const variantId = await sizeWithHistory([
        { at: "2026-10-01T07:00:00Z", reason: "opening_balance", delta: 1 },
      ]);
      const today = await testDb.db.execute<{ today: string }>(
        sql`select to_char((now() at time zone 'Europe/Kyiv')::date, 'YYYY-MM-DD') as today`,
      );
      const last = today.rows[0]?.today ?? "";

      const days = await listInventoryDays(testDb.db, variantId, "2026-10-01", "2999-01-01");
      expect(days[0]?.day).toBe("2026-10-01");
      expect(days.at(-1)).toMatchObject({ day: last, closingStock: 1, wasOutOfStock: false });

      await testDb.db
        .update(productVariants)
        .set({ trackStock: false })
        .where(eq(productVariants.id, variantId));
      expect(await listInventoryDays(testDb.db, variantId, "2026-10-01", "2999-01-01")).toEqual([]);
    });
  });
});
