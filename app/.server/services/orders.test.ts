import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutInput } from "~/lib/checkout";
import type { OrderStatus } from "~/lib/enums";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import { canViewOrder } from "./orders";

// Coco Mademoiselle (seed data): 5 ml for 990 UAH, 30 ml for 4450 UAH.
const COCO = "01a1652b-6e25-7c03-ae47-25b57131fb06";

const NOW = new Date("2026-11-05T10:00:00Z");

const customer: CheckoutInput = {
  fullName: "Олена Коваль",
  email: "olena@example.com",
  phone: "+380671234567",
  city: "Київ",
  branch: "Відділення №12",
  paymentMethod: "cod",
};

beforeAll(() => {
  // `services/cart` imports the auth session, which validates the env on import.
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("canViewOrder", () => {
  it("shows a user their own orders and anyone the orders placed in their browser", () => {
    expect(canViewOrder({ id: 1, userId: 7 }, { userId: 7, orderIds: [] })).toBe(true);
    expect(canViewOrder({ id: 1, userId: null }, { userId: null, orderIds: [1] })).toBe(true);
    expect(canViewOrder({ id: 1, userId: 7 }, { userId: 8, orderIds: [] })).toBe(false);
    expect(canViewOrder({ id: 1, userId: null }, { userId: null, orderIds: [2] })).toBe(false);
    expect(canViewOrder({ id: 1, userId: null }, { userId: 7, orderIds: [] })).toBe(false);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("order service", () => {
  let testDb: TestDatabase;
  let emailCounter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    testDb = await createTestDatabase("jassmin_orders_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { carts, orders } = await import("../db/schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(carts);
  });

  /** A seeded size of Coco Mademoiselle with its stock set to `stock`. */
  async function variant(volumeMl: number, stock: number) {
    const { and, eq } = await import("drizzle-orm");
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        publicId: productVariants.publicId,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.publicId, COCO), eq(productVariants.volumeMl, volumeMl)));
    if (!row) throw new Error(`No ${volumeMl} ml variant`);
    await testDb.db
      .update(productVariants)
      .set({ stockQuantity: stock })
      .where(eq(productVariants.id, row.id));
    return row;
  }

  async function stockOf(variantId: number) {
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .select({ stock: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    return row?.stock;
  }

  async function user() {
    const { users } = await import("../db/schema");
    emailCounter += 1;
    const [row] = await testDb.db
      .insert(users)
      .values({ fullName: "Buyer", email: `buyer${emailCounter}@example.com`, passwordHash: "x" })
      .returning();
    return row?.id ?? 0;
  }

  /** An active cart (a guest's unless `userId` is given) with these lines. */
  async function cartWith(
    lines: { variant: { id: number; productId: number }; quantity: number }[],
    userId: number | null = null,
  ) {
    const { carts, cartItems, sessions } = await import("../db/schema");
    const [session] = await testDb.db
      .insert(sessions)
      .values({ anonymousId: crypto.randomUUID() })
      .returning();
    const [cart] = await testDb.db
      .insert(carts)
      .values({ userId, sessionId: session?.sessionId })
      .returning();
    if (!cart) throw new Error("No cart");
    for (const { variant, quantity } of lines) {
      await testDb.db
        .insert(cartItems)
        .values({ cartId: cart.id, productId: variant.productId, variantId: variant.id, quantity });
    }
    return cart;
  }

  async function cartOf(cartId: number) {
    const { eq } = await import("drizzle-orm");
    const { carts } = await import("../db/schema");
    const [row] = await testDb.db.select().from(carts).where(eq(carts.id, cartId));
    return row;
  }

  async function allOrders() {
    const { orders } = await import("../db/schema");
    return testDb.db.select().from(orders);
  }

  async function queuedEmails() {
    const { orderEmails } = await import("../db/schema");
    return testDb.db.select().from(orderEmails);
  }

  it("places a guest order with server-side totals, a size snapshot and less stock", async () => {
    const { createOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { orderItems } = await import("../db/schema");
    const five = await variant(5, 10);
    const thirty = await variant(30, 3);
    const cart = await cartWith([
      { variant: five, quantity: 2 },
      { variant: thirty, quantity: 1 },
    ]);

    const result = await createOrder(
      { cartId: cart.id, userId: null, customer, locale: "en" },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);

    expect(await queuedEmails()).toEqual([
      expect.objectContaining({
        orderId: result.orderId,
        type: "confirmation",
        locale: "en",
        status: "pending",
        attempts: 0,
      }),
    ]);
    expect(await allOrders()).toEqual([
      expect.objectContaining({
        id: result.orderId,
        cartId: cart.id,
        userId: null,
        guestFullName: "Олена Коваль",
        guestEmail: "olena@example.com",
        guestPhone: "+380671234567",
        shippingAddress: "Київ, Відділення №12",
        paymentMethod: "cod",
        status: "pending",
        paymentStatus: "unpaid",
        subtotal: "6430.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        totalAmount: "6430.00",
        currency: "UAH",
        freeShipping: true,
      }),
    ]);
    const items = await testDb.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, result.orderId));
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: five.id,
          volumeMl: 5,
          quantity: 2,
          priceAtPurchase: "990.00",
        }),
        expect.objectContaining({
          variantId: thirty.id,
          volumeMl: 30,
          quantity: 1,
          priceAtPurchase: "4450.00",
        }),
      ]),
    );
    expect(await stockOf(five.id)).toBe(8);
    expect(await stockOf(thirty.id)).toBe(2);
    // The order and its product's lower stock are queued for Strapi (#40).
    const { and, eq: equals } = await import("drizzle-orm");
    const { cmsOutbox } = await import("../db/schema");
    const queued = await testDb.db
      .select({
        entity: cmsOutbox.entity,
        entityId: cmsOutbox.entityId,
        syncedAt: cmsOutbox.syncedAt,
      })
      .from(cmsOutbox)
      .where(and(equals(cmsOutbox.entity, "order"), equals(cmsOutbox.entityId, result.orderId)));
    expect(queued).toEqual([{ entity: "order", entityId: result.orderId, syncedAt: null }]);
    const products = await testDb.db
      .select({ entityId: cmsOutbox.entityId, syncedAt: cmsOutbox.syncedAt })
      .from(cmsOutbox)
      .where(and(equals(cmsOutbox.entity, "product"), equals(cmsOutbox.entityId, five.productId)));
    expect(products).toEqual([{ entityId: five.productId, syncedAt: null }]);
    const after = await cartOf(cart.id);
    expect(after?.status).toBe("converted");
    expect(after?.updatedAt.getTime()).toBeGreaterThan(cart.updatedAt.getTime());
  });

  async function historyOf(orderId: number) {
    const { listOrderStatusHistory } = await import("../db/queries/order-status-history");
    return (await listOrderStatusHistory(testDb.db, orderId)).map(
      ({ status, source, changedAt }) => ({ status, source, changedAt }),
    );
  }

  async function cityOf(userId: number) {
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../db/schema");
    const [row] = await testDb.db
      .select({ city: users.city })
      .from(users)
      .where(eq(users.id, userId));
    return row?.city;
  }

  it("records the order's first status and the buyer's delivery city (#128)", async () => {
    const { createOrder } = await import("./orders");
    const userId = await user();
    const five = await variant(5, 10);

    const result = await createOrder(
      {
        cartId: (await cartWith([{ variant: five, quantity: 1 }], userId)).id,
        userId,
        customer: { ...customer, city: "Одеса" },
        locale: "uk",
        now: NOW,
      },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);

    expect(await historyOf(result.orderId)).toEqual([
      { status: "pending", source: "checkout", changedAt: NOW },
    ]);
    const [order] = await allOrders();
    expect(order?.createdAt).toEqual(NOW);
    expect(await cityOf(userId)).toBe("Одеса");

    // The latest order's city wins; a guest order leaves every user alone.
    await createOrder(
      {
        cartId: (await cartWith([{ variant: five, quantity: 1 }], userId)).id,
        userId,
        customer: { ...customer, city: "Львів" },
        locale: "uk",
      },
      testDb.db,
    );
    expect(await cityOf(userId)).toBe("Львів");
    await createOrder(
      {
        cartId: (await cartWith([{ variant: five, quantity: 1 }])).id,
        userId: null,
        customer: { ...customer, city: "Харків" },
        locale: "uk",
      },
      testDb.db,
    );
    expect(await cityOf(userId)).toBe("Львів");
  });

  it("links a registered user's order and only gives free shipping from 1500 UAH", async () => {
    const { createOrder } = await import("./orders");
    const userId = await user();
    const five = await variant(5, 10);

    const small = await createOrder(
      {
        cartId: (await cartWith([{ variant: five, quantity: 1 }], userId)).id,
        userId,
        customer,
        locale: "uk",
      },
      testDb.db,
    );
    expect(small.ok).toBe(true);
    const [order] = await allOrders();
    expect(order).toMatchObject({ userId, subtotal: "990.00", freeShipping: false });

    const { eq } = await import("drizzle-orm");
    const { orders, productVariants } = await import("../db/schema");
    try {
      for (const [price, freeShipping] of [
        ["1499.99", false],
        ["1500.00", true],
      ] as const) {
        await testDb.db.delete(orders);
        const cart = await cartWith([{ variant: five, quantity: 1 }]);
        await testDb.db
          .update(productVariants)
          .set({ price })
          .where(eq(productVariants.id, five.id));
        await createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db);
        expect(await allOrders()).toEqual([
          expect.objectContaining({ subtotal: price, freeShipping }),
        ]);
      }
    } finally {
      await testDb.db
        .update(productVariants)
        .set({ price: "990.00" })
        .where(eq(productVariants.id, five.id));
    }
  });

  it("sells a size that doesn't track stock without checking or lowering it (#98)", async () => {
    const { createOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { cmsOutbox, products, productVariants } = await import("../db/schema");
    const [product] = await testDb.db
      .insert(products)
      .values({ title: "Poured", brand: "Test", gender: "women", price: "240.00", volumeMl: 10 })
      .returning({ id: products.id });
    const [poured] = await testDb.db
      .insert(productVariants)
      .values({ productId: product?.id ?? 0, volumeMl: 10, price: "240.00", stockQuantity: 0 })
      .returning({ id: productVariants.id, productId: productVariants.productId });
    if (!poured) throw new Error("No poured size");
    const five = await variant(5, 10);
    const cart = await cartWith([
      { variant: poured, quantity: 5 },
      { variant: five, quantity: 1 },
    ]);

    const result = await createOrder(
      { cartId: cart.id, userId: null, customer, locale: "uk" },
      testDb.db,
    );

    expect(result).toMatchObject({ ok: true, placed: true });
    expect(await stockOf(poured.id)).toBe(0);
    // A tracked size in the same order still loses its unit.
    expect(await stockOf(five.id)).toBe(9);
    // Nothing changed on the untracked product, so Strapi has nothing to update.
    const queued = await testDb.db
      .select()
      .from(cmsOutbox)
      .where(eq(cmsOutbox.entityId, poured.productId));
    expect(queued.filter((row) => row.entity === "product")).toEqual([]);
  });

  it("changes nothing when a line asks for more than is in stock", async () => {
    const { createOrder } = await import("./orders");
    const five = await variant(5, 10);
    const thirty = await variant(30, 1);
    const cart = await cartWith([
      { variant: five, quantity: 2 },
      { variant: thirty, quantity: 2 },
    ]);

    expect(
      await createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db),
    ).toEqual({
      ok: false,
      error: "insufficient-stock",
      lines: [{ variantId: expect.any(String), available: 1 }],
    });
    expect(await allOrders()).toEqual([]);
    expect(await queuedEmails()).toEqual([]);
    expect(await stockOf(five.id)).toBe(10);
    expect(await stockOf(thirty.id)).toBe(1);
    expect((await cartOf(cart.id))?.status).toBe("active");
  });

  it("treats a line of an archived product as out of stock", async () => {
    const { createOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const five = await variant(5, 10);
    const cart = await cartWith([{ variant: five, quantity: 1 }]);
    await testDb.db.update(products).set({ active: false }).where(eq(products.id, five.productId));
    try {
      expect(
        await createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db),
      ).toEqual({
        ok: false,
        error: "insufficient-stock",
        lines: [{ variantId: expect.any(String), available: 0 }],
      });
      expect(await stockOf(five.id)).toBe(10);
    } finally {
      await testDb.db.update(products).set({ active: true }).where(eq(products.id, five.productId));
    }
  });

  it("rolls everything back when a later write fails", async () => {
    const { createOrder } = await import("./orders");
    const { sql } = await import("drizzle-orm");
    const five = await variant(5, 10);
    const cart = await cartWith([{ variant: five, quantity: 2 }]);
    // Make marking the cart `converted` (the last write) fail.
    await testDb.db.execute(sql`
      create function fail_convert() returns trigger language plpgsql as
        $$ begin raise exception 'conversion failed'; end $$;
      create trigger fail_convert before update of status on carts
        for each row when (new.status = 'converted') execute function fail_convert();
    `);
    try {
      await expect(
        createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db),
      ).rejects.toThrow();
    } finally {
      await testDb.db.execute(sql`
        drop trigger fail_convert on carts;
        drop function fail_convert();
      `);
    }

    expect(await allOrders()).toEqual([]);
    expect(await queuedEmails()).toEqual([]);
    expect(await stockOf(five.id)).toBe(10);
    expect((await cartOf(cart.id))?.status).toBe("active");
  });

  describe("discounts (#59)", () => {
    beforeEach(async () => {
      const { discounts } = await import("../db/schema");
      // Orders keep their rule (restrict); the outer hook already deleted them.
      await testDb.db.delete(discounts);
    });

    type NewDiscount = typeof import("../db/schema").discounts.$inferInsert;

    async function insertDiscount(values: Partial<NewDiscount> & Pick<NewDiscount, "slug">) {
      const { discounts } = await import("../db/schema");
      const [row] = await testDb.db
        .insert(discounts)
        .values({ kind: "percent", value: "10", ...values })
        .returning({ id: discounts.id });
      if (!row) throw new Error("no discount");
      return row.id;
    }

    async function withCode(cartId: number, discountId: number) {
      const { eq } = await import("drizzle-orm");
      const { carts } = await import("../db/schema");
      await testDb.db.update(carts).set({ discountId }).where(eq(carts.id, cartId));
    }

    async function redemptions(discountId: number) {
      const { eq } = await import("drizzle-orm");
      const { discounts } = await import("../db/schema");
      const [row] = await testDb.db
        .select({ count: discounts.redemptionCount })
        .from(discounts)
        .where(eq(discounts.id, discountId));
      return row?.count;
    }

    async function place(cartId: number, extra: { expectedTotal?: string; now?: Date } = {}) {
      const { createOrder } = await import("./orders");
      return createOrder({ cartId, userId: null, customer, locale: "uk", ...extra }, testDb.db);
    }

    it("writes the code's discount and rule on the order and counts the redemption", async () => {
      const code = await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
      const thirty = await variant(30, 3);
      const cart = await cartWith([{ variant: thirty, quantity: 1 }]);
      await withCode(cart.id, code);

      const result = await place(cart.id, { expectedTotal: "4005.00" });

      expect(result).toEqual({
        ok: true,
        orderId: expect.any(Number),
        placed: true,
        subtotal: "4450.00",
        discountAmount: "445.00",
        totalAmount: "4005.00",
        discountId: code,
        discountCode: "JASSMIN10",
        discountKind: "percent",
        giftCardAmount: "0.00",
        paymentMethod: "cod",
        // The line's share of the discount, for the purchase event (#129).
        items: [
          {
            variant_id: thirty.publicId,
            quantity: 1,
            unit_price: "4450.00",
            discount_allocated: "445.00",
          },
        ],
        isFirstOrder: true,
      });
      expect(await allOrders()).toEqual([
        expect.objectContaining({
          subtotal: "4450.00",
          discountAmount: "445.00",
          totalAmount: "4005.00",
          discountId: code,
          freeShipping: true,
        }),
      ]);
      expect(await redemptions(code)).toBe(1);
    });

    it("splits the discount over the lines it was taken off (#128)", async () => {
      const { eq } = await import("drizzle-orm");
      const { orderItems } = await import("../db/schema");
      const code = await insertDiscount({ slug: "thirty", code: "THIRTY", scopeVolumesMl: [30] });
      const five = await variant(5, 10);
      const thirty = await variant(30, 3);
      const cart = await cartWith([
        { variant: five, quantity: 2 },
        { variant: thirty, quantity: 1 },
      ]);
      await withCode(cart.id, code);

      const result = await place(cart.id);
      if (!result.ok) throw new Error(result.error);

      expect(result).toMatchObject({ discountAmount: "445.00" });
      const lines = await testDb.db
        .select({ variantId: orderItems.variantId, discount: orderItems.discountAllocated })
        .from(orderItems)
        .where(eq(orderItems.orderId, result.orderId));
      // Only the 30 ml line qualifies for the code, so it carries the whole discount.
      expect(lines).toEqual(
        expect.arrayContaining([
          { variantId: five.id, discount: "0.00" },
          { variantId: thirty.id, discount: "445.00" },
        ]),
      );
    });

    it("splits a trio's saving over the units in the set (#128)", async () => {
      const { eq } = await import("drizzle-orm");
      const { orderItems } = await import("../db/schema");
      await insertDiscount({
        slug: "trio",
        kind: "fixed_price_set",
        value: "499.00",
        scopeVolumesMl: [5],
        minQuantity: 3,
      });
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 3 }]);

      const result = await place(cart.id);
      if (!result.ok) throw new Error(result.error);

      // 3 × 990 − 499 = 2471 ₴, all on the one line.
      const lines = await testDb.db
        .select({ discount: orderItems.discountAllocated })
        .from(orderItems)
        .where(eq(orderItems.orderId, result.orderId));
      expect(lines).toEqual([{ discount: "2471.00" }]);
      expect(result).toMatchObject({ discountAmount: "2471.00" });
    });

    it("shows the discount on the confirmation and the account order page", async () => {
      const { createOrder, getAccountOrder, getOrderConfirmation } = await import("./orders");
      const code = await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
      const userId = await user();
      const cart = await cartWith([{ variant: await variant(30, 3), quantity: 1 }], userId);
      await withCode(cart.id, code);

      const result = await createOrder(
        { cartId: cart.id, userId, customer, locale: "uk" },
        testDb.db,
      );
      // One active cart per user: the next one once the first became an order.
      const plain = await cartWith([{ variant: await variant(5, 10), quantity: 1 }], userId);
      const plainResult = await createOrder(
        { cartId: plain.id, userId, customer, locale: "uk" },
        testDb.db,
      );
      if (!result.ok || !plainResult.ok) throw new Error("not placed");

      const discount = { amount: "445.00", code: "JASSMIN10", kind: "percent" };
      const viewer = { userId, orderIds: [] };
      expect(await getOrderConfirmation(result.orderId, viewer, testDb.db)).toMatchObject({
        discountAmount: "445.00",
        discount,
        totalAmount: "4005.00",
      });
      expect(await getAccountOrder(userId, result.orderId, testDb.db)).toMatchObject({
        subtotal: "4450.00",
        discount,
        totalAmount: "4005.00",
      });
      expect((await getAccountOrder(userId, plainResult.orderId, testDb.db))?.discount).toBeNull();
    });

    it("applies the tester trio by itself, up to three sets, and nothing else", async () => {
      const trio = await insertDiscount({
        slug: "tester-trio",
        kind: "fixed_price_set",
        value: "499",
        scopeVolumesMl: [10],
        scopePackSize: 1,
        minQuantity: 3,
        maxSets: 3,
      });
      const ten = await variant(10, 20);
      // Ten 10 ml at 1350 ₴: three sets at 499 ₴ each and one at full price.
      const trioCart = await cartWith([{ variant: ten, quantity: 10 }]);
      const thirtyCart = await cartWith([{ variant: await variant(30, 3), quantity: 2 }]);

      expect(await place(trioCart.id)).toMatchObject({
        subtotal: "13500.00",
        discountAmount: "10653.00",
        totalAmount: "2847.00",
        discountId: trio,
        discountCode: null,
        discountKind: "fixed_price_set",
      });
      // Two 30 ml bottles stay at full price: there is no bundle rule.
      expect(await place(thirtyCart.id)).toMatchObject({
        subtotal: "8900.00",
        discountAmount: "0.00",
        totalAmount: "8900.00",
        discountId: null,
      });
      expect(await redemptions(trio)).toBe(1);
    });

    it("decides free delivery on the discounted subtotal", async () => {
      const code = await insertDiscount({
        slug: "big",
        code: "BIG",
        kind: "fixed_amount",
        value: "1000",
      });
      const five = await variant(5, 10);
      const discounted = await cartWith([{ variant: five, quantity: 2 }]);
      const full = await cartWith([{ variant: five, quantity: 2 }]);
      await withCode(discounted.id, code);

      await place(discounted.id);
      await place(full.id);

      const byCart = new Map((await allOrders()).map((order) => [order.cartId, order]));
      // 1980 ₴ − 1000 ₴ = 980 ₴, under the 1500 ₴ threshold.
      expect(byCart.get(discounted.id)).toMatchObject({
        totalAmount: "980.00",
        freeShipping: false,
      });
      expect(byCart.get(full.id)).toMatchObject({ totalAmount: "1980.00", freeShipping: true });
    });

    it("never redeems a code past its limit for concurrent checkouts", async () => {
      const code = await insertDiscount({ slug: "once", code: "ONCE", maxRedemptions: 1 });
      const five = await variant(5, 10);
      const first = await cartWith([{ variant: five, quantity: 1 }]);
      const second = await cartWith([{ variant: five, quantity: 1 }]);
      await withCode(first.id, code);
      await withCode(second.id, code);

      // Both pages showed 891 ₴ (990 ₴ − 10%).
      const results = await Promise.all([
        place(first.id, { expectedTotal: "891.00" }),
        place(second.id, { expectedTotal: "891.00" }),
      ]);

      expect(results.filter((r) => r.ok)).toEqual([
        expect.objectContaining({ discountId: code, totalAmount: "891.00" }),
      ]);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "total-changed" }]);
      expect(await redemptions(code)).toBe(1);
      expect(await allOrders()).toHaveLength(1);
      expect(await stockOf(five.id)).toBe(9);
    });

    it("charges full price for a used-up code when no total is expected", async () => {
      const code = await insertDiscount({
        slug: "used",
        code: "USED",
        maxRedemptions: 1,
        redemptionCount: 1,
      });
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      await withCode(cart.id, code);

      expect(await place(cart.id)).toMatchObject({
        totalAmount: "990.00",
        discountId: null,
        discountCode: null,
      });
    });

    it("writes nothing when the code expired after the page showed it", async () => {
      const endsAt = new Date("2026-11-01T00:00:00Z");
      const code = await insertDiscount({ slug: "ending", code: "ENDING", endsAt });
      const five = await variant(5, 10);
      const cart = await cartWith([{ variant: five, quantity: 1 }]);
      await withCode(cart.id, code);

      expect(await place(cart.id, { expectedTotal: "891.00", now: endsAt })).toEqual({
        ok: false,
        error: "total-changed",
      });
      expect(await allOrders()).toEqual([]);
      expect(await queuedEmails()).toEqual([]);
      expect(await stockOf(five.id)).toBe(10);
      expect((await cartOf(cart.id))?.status).toBe("active");
      expect(await redemptions(code)).toBe(0);
    });

    it("rolls back the redemption with the order", async () => {
      const { sql } = await import("drizzle-orm");
      const code = await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      await withCode(cart.id, code);
      await testDb.db.execute(sql`
        create function fail_convert() returns trigger language plpgsql as
          $$ begin raise exception 'conversion failed'; end $$;
        create trigger fail_convert before update of status on carts
          for each row when (new.status = 'converted') execute function fail_convert();
      `);
      try {
        await expect(place(cart.id)).rejects.toThrow();
      } finally {
        await testDb.db.execute(sql`
          drop trigger fail_convert on carts;
          drop function fail_convert();
        `);
      }
      expect(await redemptions(code)).toBe(0);
      expect(await allOrders()).toEqual([]);
    });
  });

  describe("gift cards (#125)", () => {
    let codes = 0;

    beforeEach(async () => {
      const { giftCards } = await import("../db/schema");
      // The outer hook deleted the orders, and with them the redemptions.
      await testDb.db.delete(giftCards);
    });

    /** An active card with `balance` left (of `initialAmount`), expiring a year from `NOW`. */
    async function activeCard(
      balance: string,
      values: Partial<typeof import("../db/schema").giftCards.$inferInsert> = {},
    ) {
      const { giftCards } = await import("../db/schema");
      codes += 1;
      const [row] = await testDb.db
        .insert(giftCards)
        .values({
          code: `GFTC${String(codes).padStart(12, "0")}`,
          initialAmount: "1000.00",
          balance,
          status: "active",
          buyerEmail: "buyer@example.com",
          locale: "uk",
          activatedAt: NOW,
          expiresAt: new Date("2027-11-05T10:00:00Z"),
          ...values,
        })
        .returning();
      if (!row) throw new Error("no gift card");
      return row;
    }

    async function withGiftCard(cartId: number, giftCardId: number) {
      const { eq } = await import("drizzle-orm");
      const { carts } = await import("../db/schema");
      await testDb.db.update(carts).set({ giftCardId }).where(eq(carts.id, cartId));
    }

    async function cardOf(giftCardId: number) {
      const { findGiftCard } = await import("../db/queries/gift-cards");
      return findGiftCard(testDb.db, giftCardId);
    }

    async function redemptionsOf(giftCardId: number) {
      const { eq } = await import("drizzle-orm");
      const { giftCardRedemptions } = await import("../db/schema");
      return testDb.db
        .select({ orderId: giftCardRedemptions.orderId, amount: giftCardRedemptions.amount })
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.giftCardId, giftCardId));
    }

    async function place(
      cartId: number,
      extra: { expectedTotal?: string; paymentMethod?: "card" | "cod" } = {},
    ) {
      const { createOrder } = await import("./orders");
      const { paymentMethod = "cod", expectedTotal } = extra;
      return createOrder(
        {
          cartId,
          userId: null,
          customer: { ...customer, paymentMethod },
          locale: "uk",
          expectedTotal,
          now: NOW,
        },
        testDb.db,
      );
    }

    it("takes the whole balance off a dearer order and leaves the rest to pay", async () => {
      const card = await activeCard("500.00", { initialAmount: "500.00" });
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      await withGiftCard(cart.id, card.id);

      const result = await place(cart.id, { expectedTotal: "490.00" });

      expect(result).toMatchObject({
        ok: true,
        placed: true,
        subtotal: "990.00",
        giftCardAmount: "500.00",
        totalAmount: "490.00",
        paymentMethod: "cod",
      });
      const [order] = await allOrders();
      expect(order).toMatchObject({
        giftCardAmount: "500.00",
        totalAmount: "490.00",
        paymentMethod: "cod",
        status: "pending",
        paymentStatus: "unpaid",
        freeShipping: false,
      });
      expect(await cardOf(card.id)).toMatchObject({ balance: "0.00", status: "used_up" });
      expect(await redemptionsOf(card.id)).toEqual([{ orderId: order?.id, amount: "500.00" }]);
    });

    it("pays a cheaper order in full, keeps the rest on the card and needs no payment", async () => {
      const card = await activeCard("1000.00");
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      await withGiftCard(cart.id, card.id);

      const result = await place(cart.id, { expectedTotal: "0.00", paymentMethod: "card" });

      expect(result).toMatchObject({
        ok: true,
        giftCardAmount: "990.00",
        totalAmount: "0.00",
        paymentMethod: "gift_card",
      });
      const [order] = await allOrders();
      expect(order).toMatchObject({
        paymentMethod: "gift_card",
        status: "paid",
        paymentStatus: "paid",
        totalAmount: "0.00",
      });
      expect(order?.paidAt).toBeInstanceOf(Date);
      // Placed straight into `paid`: one history row, at the payment time (#128).
      expect(await historyOf(order?.id ?? 0)).toEqual([
        { status: "paid", source: "checkout", changedAt: order?.paidAt },
      ]);
      expect(await cardOf(card.id)).toMatchObject({ balance: "10.00", status: "active" });

      const { isPayable } = await import("./payments");
      expect(order && isPayable(order)).toBe(false);
    });

    it("pays after the discount, without changing free delivery", async () => {
      const { eq } = await import("drizzle-orm");
      const { carts, discounts } = await import("../db/schema");
      const [promo] = await testDb.db
        .insert(discounts)
        .values({ slug: "gift-card-test", code: "GIFTTEST10", kind: "percent", value: "10" })
        .onConflictDoUpdate({ target: discounts.slug, set: { active: true } })
        .returning({ id: discounts.id });
      const card = await activeCard("1000.00");
      // 4450 UAH, 10% off: 4005 UAH, free delivery; the card then pays 1000 UAH of it.
      const cart = await cartWith([{ variant: await variant(30, 10), quantity: 1 }]);
      await testDb.db.update(carts).set({ discountId: promo?.id }).where(eq(carts.id, cart.id));
      await withGiftCard(cart.id, card.id);

      const result = await place(cart.id, { expectedTotal: "3005.00" });

      expect(result).toMatchObject({
        ok: true,
        subtotal: "4450.00",
        discountAmount: "445.00",
        giftCardAmount: "1000.00",
        totalAmount: "3005.00",
      });
      const [order] = await allOrders();
      expect(order).toMatchObject({ freeShipping: true, totalAmount: "3005.00" });
    });

    it("keeps free delivery decided before the gift card", async () => {
      // 4450 UAH qualifies for free delivery; the card brings what's left to pay below 1500 UAH.
      const card = await activeCard("2000.00", { initialAmount: "2000.00" });
      const cart = await cartWith([{ variant: await variant(30, 10), quantity: 1 }]);
      await withGiftCard(cart.id, card.id);

      await place(cart.id);
      const [order] = await allOrders();
      expect(order).toMatchObject({ freeShipping: true, totalAmount: "2450.00" });
    });

    it("refuses an order whose card expired since the page showed it", async () => {
      const expired = await activeCard("1000.00", { expiresAt: NOW });
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      await withGiftCard(cart.id, expired.id);

      expect(await place(cart.id, { expectedTotal: "0.00" })).toEqual({
        ok: false,
        error: "total-changed",
      });
      expect(await allOrders()).toEqual([]);
      expect(await cardOf(expired.id)).toMatchObject({ balance: "1000.00" });
      expect(await redemptionsOf(expired.id)).toEqual([]);
    });

    it("never lets two orders spend more than the card's balance", async () => {
      const card = await activeCard("1000.00");
      const five = await variant(5, 10);
      const first = await cartWith([{ variant: five, quantity: 1 }]);
      const second = await cartWith([{ variant: five, quantity: 1 }]);
      await withGiftCard(first.id, card.id);
      await withGiftCard(second.id, card.id);

      // Both pages showed the order as fully paid by the card.
      const results = await Promise.all([
        place(first.id, { expectedTotal: "0.00" }),
        place(second.id, { expectedTotal: "0.00" }),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "total-changed" }]);
      expect(await cardOf(card.id)).toMatchObject({ balance: "10.00", status: "active" });
      expect(await redemptionsOf(card.id)).toHaveLength(1);
    });

    it("spends what's left on the card on a later order", async () => {
      const card = await activeCard("1000.00");
      const five = await variant(5, 10);
      const first = await cartWith([{ variant: five, quantity: 1 }]);
      const second = await cartWith([{ variant: five, quantity: 1 }]);
      await withGiftCard(first.id, card.id);
      await withGiftCard(second.id, card.id);

      await place(first.id);
      expect(await place(second.id)).toMatchObject({
        ok: true,
        giftCardAmount: "10.00",
        totalAmount: "980.00",
        paymentMethod: "cod",
      });
      expect(await cardOf(card.id)).toMatchObject({ balance: "0.00", status: "used_up" });
    });

    it("applies a usable code to the cart, and refuses the rest without writing", async () => {
      const { applyGiftCard, getCheckoutGiftCard, removeGiftCard } = await import("./gift-cards");
      const { eq } = await import("drizzle-orm");
      const { sessions } = await import("../db/schema");
      const cart = await cartWith([{ variant: await variant(5, 10), quantity: 1 }]);
      const [session] = await testDb.db
        .select()
        .from(sessions)
        .where(eq(sessions.sessionId, cart.sessionId ?? ""));
      const owner = { userId: null, anonymousId: session?.anonymousId };

      const pending = await activeCard("1000.00", {
        status: "pending",
        activatedAt: null,
        expiresAt: null,
      });
      const expired = await activeCard("1000.00", { status: "expired" });
      const usedUp = await activeCard("0.00", { status: "used_up" });
      for (const [code, error] of [
        ["NNNN-NNNN-NNNN-NNNN", "unknown"],
        ["too short", "unknown"],
        [pending.code, "not-active"],
        [expired.code, "expired"],
        [usedUp.code, "used-up"],
      ] as const) {
        expect(await applyGiftCard(owner, code, testDb.db, NOW)).toEqual({ ok: false, error });
      }
      expect((await cartOf(cart.id))?.giftCardId).toBeNull();

      const card = await activeCard("600.00");
      const typed = card.code.toLowerCase().replace(/(.{4})(?!$)/g, "$1-");
      expect(await applyGiftCard(owner, typed, testDb.db, NOW)).toEqual({ ok: true });
      expect((await cartOf(cart.id))?.giftCardId).toBe(card.id);
      expect(await getCheckoutGiftCard(owner, "990.00", testDb.db, NOW)).toEqual({
        maskedCode: `••••-••••-••••-${card.code.slice(-4)}`,
        amount: "600.00",
        balanceAfter: "0.00",
      });

      await removeGiftCard(owner, testDb.db);
      expect((await cartOf(cart.id))?.giftCardId).toBeNull();
      expect(await getCheckoutGiftCard(owner, "990.00", testDb.db, NOW)).toBeNull();
    });
  });

  it("never oversells the last unit to concurrent checkouts", async () => {
    const { createOrder } = await import("./orders");
    const hundred = await variant(100, 1);
    const first = await cartWith([{ variant: hundred, quantity: 1 }]);
    const second = await cartWith([{ variant: hundred, quantity: 1 }]);

    const results = await Promise.all([
      createOrder({ cartId: first.id, userId: null, customer, locale: "uk" }, testDb.db),
      createOrder({ cartId: second.id, userId: null, customer, locale: "uk" }, testDb.db),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      {
        ok: false,
        error: "insufficient-stock",
        lines: [{ variantId: expect.any(String), available: 0 }],
      },
    ]);
    expect(await allOrders()).toHaveLength(1);
    expect(await stockOf(hundred.id)).toBe(0);
  });

  it("returns the same order when the same cart is submitted twice", async () => {
    const { createOrder } = await import("./orders");
    const five = await variant(5, 10);
    const cart = await cartWith([{ variant: five, quantity: 3 }]);
    const input = { cartId: cart.id, userId: null, customer, locale: "uk" as const };

    const [a, b] = await Promise.all([
      createOrder(input, testDb.db),
      createOrder(input, testDb.db),
    ]);
    const again = await createOrder(input, testDb.db);

    // Only the request that won the lock placed the order; the others get its id.
    const placed = [a, b].find((result) => result.ok && result.placed);
    expect(placed).toEqual({
      ok: true,
      orderId: expect.any(Number),
      placed: true,
      subtotal: "2970.00",
      discountAmount: "0.00",
      totalAmount: "2970.00",
      discountId: null,
      discountCode: null,
      discountKind: null,
      giftCardAmount: "0.00",
      paymentMethod: "cod",
      items: [
        {
          variant_id: five.publicId,
          quantity: 3,
          unit_price: "990.00",
          discount_allocated: "0.00",
        },
      ],
      isFirstOrder: true,
    });
    const orderId = placed?.ok ? placed.orderId : undefined;
    expect([a, b]).toContainEqual({ ok: true, orderId, placed: false });
    expect(again).toEqual({ ok: true, orderId, placed: false });
    expect(await allOrders()).toHaveLength(1);
    expect(await queuedEmails()).toEqual([expect.objectContaining({ orderId })]);
    expect(await stockOf(five.id)).toBe(7);
  });

  it("tells a customer's first order from a repeat, by user or by email in any case (#129)", async () => {
    const { createOrder } = await import("./orders");
    const five = await variant(5, 20);
    const firstOf = async (userId: number | null, email: string) => {
      const cart = await cartWith([{ variant: five, quantity: 1 }], userId);
      const result = await createOrder(
        { cartId: cart.id, userId, customer: { ...customer, email }, locale: "uk" },
        testDb.db,
      );
      return result.ok && result.placed ? result.isFirstOrder : undefined;
    };
    const buyer = await user();

    expect(await firstOf(null, "guest@example.com")).toBe(true);
    expect(await firstOf(null, "Guest@Example.com")).toBe(false);
    // A registered user's first order, even after someone else's.
    expect(await firstOf(buyer, "new@example.com")).toBe(true);
    // The same user with another email.
    expect(await firstOf(buyer, "other@example.com")).toBe(false);
    // A guest using the email of an earlier guest order.
    expect(await firstOf(null, "other@example.com")).toBe(false);
  });

  it("reports an empty or missing cart", async () => {
    const { createOrder } = await import("./orders");

    const empty = await cartWith([]);
    expect(
      await createOrder({ cartId: empty.id, userId: null, customer, locale: "uk" }, testDb.db),
    ).toEqual({
      ok: false,
      error: "cart-empty",
    });
    expect(
      await createOrder({ cartId: 999_999, userId: null, customer, locale: "uk" }, testDb.db),
    ).toEqual({
      ok: false,
      error: "cart-empty",
    });
  });

  it("shows the confirmation only to the order's owner", async () => {
    const { createOrder, getOrderConfirmation } = await import("./orders");
    const userId = await user();
    const five = await variant(5, 10);
    const cart = await cartWith([{ variant: five, quantity: 2 }], userId);
    const result = await createOrder(
      { cartId: cart.id, userId, customer, locale: "uk" },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);

    const confirmation = await getOrderConfirmation(
      result.orderId,
      { userId, orderIds: [] },
      testDb.db,
    );
    expect(confirmation).toMatchObject({
      id: result.orderId,
      phone: "+380671234567",
      shippingAddress: "Київ, Відділення №12",
      totalAmount: "1980.00",
      freeShipping: true,
      lines: [
        {
          title: "Coco Mademoiselle Eau de Parfum",
          volumeMl: 5,
          quantity: 2,
          unitPrice: "990.00",
          lineTotal: "1980.00",
        },
      ],
    });
    expect(confirmation).not.toHaveProperty("userId");
    // The email's view of the order skips the viewer check but is otherwise the same.
    const { findOrderConfirmation } = await import("../db/queries/orders");
    expect(await findOrderConfirmation(testDb.db, result.orderId)).toEqual(confirmation);
    expect(await findOrderConfirmation(testDb.db, 999_999)).toBeUndefined();
    expect(
      await getOrderConfirmation(result.orderId, { userId: null, orderIds: [] }, testDb.db),
    ).toBeUndefined();
    expect(
      await getOrderConfirmation(999_999, { userId, orderIds: [999_999] }, testDb.db),
    ).toBeUndefined();
  });

  /** Places an order for the user from a fresh cart with these lines. */
  async function placeOrder(
    userId: number | null,
    lines: { variant: { id: number; productId: number }; quantity: number }[],
  ) {
    const { createOrder } = await import("./orders");
    const cart = await cartWith(lines, userId);
    const result = await createOrder(
      { cartId: cart.id, userId, customer, locale: "uk" },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);
    return result.orderId;
  }

  async function setStatus(orderId: number, status: OrderStatus, createdAt?: Date) {
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("../db/schema");
    await testDb.db
      .update(orders)
      .set(createdAt ? { status, createdAt } : { status })
      .where(eq(orders.id, orderId));
  }

  it("lists only the user's own orders, split by status, newest first", async () => {
    const { getAccountOrders } = await import("./orders");
    const me = await user();
    const other = await user();
    const five = await variant(5, 50);
    const thirty = await variant(30, 50);

    const pending = await placeOrder(me, [{ variant: five, quantity: 1 }]);
    const shipped = await placeOrder(me, [
      { variant: five, quantity: 2 },
      { variant: thirty, quantity: 1 },
    ]);
    const completed = await placeOrder(me, [{ variant: thirty, quantity: 1 }]);
    const cancelled = await placeOrder(me, [{ variant: five, quantity: 1 }]);
    await placeOrder(other, [{ variant: five, quantity: 1 }]);
    await placeOrder(null, [{ variant: five, quantity: 1 }]);
    await setStatus(pending, "pending", new Date("2026-10-01T10:00:00Z"));
    await setStatus(shipped, "shipped", new Date("2026-10-03T10:00:00Z"));
    await setStatus(completed, "completed", new Date("2026-09-01T10:00:00Z"));
    await setStatus(cancelled, "cancelled", new Date("2026-09-15T10:00:00Z"));

    const { current, previous } = await getAccountOrders(me, testDb.db);

    expect(current.map((o) => [o.id, o.status])).toEqual([
      [shipped, "shipped"],
      [pending, "pending"],
    ]);
    expect(previous.map((o) => [o.id, o.status])).toEqual([
      [cancelled, "cancelled"],
      [completed, "completed"],
    ]);
    expect(current[0]).toMatchObject({
      itemCount: 3,
      totalAmount: "6430.00",
      lines: [
        { volumeMl: 5, quantity: 2, unitPrice: "990.00", lineTotal: "1980.00" },
        { volumeMl: 30, quantity: 1, unitPrice: "4450.00", lineTotal: "4450.00" },
      ],
    });
    expect(await getAccountOrders(await user(), testDb.db)).toEqual({ current: [], previous: [] });
  });

  it("keeps the price at purchase when the product's price changes later", async () => {
    const { getAccountOrder, getAccountOrders } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    const me = await user();
    const five = await variant(5, 10);
    const orderId = await placeOrder(me, [{ variant: five, quantity: 2 }]);

    await testDb.db
      .update(productVariants)
      .set({ price: "1500.00" })
      .where(eq(productVariants.id, five.id));
    try {
      const { current } = await getAccountOrders(me, testDb.db);
      expect(current[0]?.lines[0]).toMatchObject({ unitPrice: "990.00", lineTotal: "1980.00" });
      expect((await getAccountOrder(me, orderId, testDb.db))?.lines[0]).toMatchObject({
        unitPrice: "990.00",
        lineTotal: "1980.00",
      });
    } finally {
      await testDb.db
        .update(productVariants)
        .set({ price: "990.00" })
        .where(eq(productVariants.id, five.id));
    }
  });

  it("shows an order's details only to the user who placed it", async () => {
    const { getAccountOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../db/schema");
    const me = await user();
    const other = await user();
    const five = await variant(5, 10);
    const mine = await placeOrder(me, [{ variant: five, quantity: 1 }]);
    const theirs = await placeOrder(other, [{ variant: five, quantity: 1 }]);
    // A guest order placed with my email isn't mine (linking guest orders is out of scope).
    const [account] = await testDb.db.select().from(users).where(eq(users.id, me));
    const { createOrder } = await import("./orders");
    const guestCart = await cartWith([{ variant: five, quantity: 1 }]);
    const guest = await createOrder(
      {
        cartId: guestCart.id,
        userId: null,
        customer: { ...customer, email: account?.email ?? "" },
        locale: "uk",
      },
      testDb.db,
    );
    if (!guest.ok) throw new Error(guest.error);

    expect(await getAccountOrder(me, mine, testDb.db)).toMatchObject({
      id: mine,
      status: "pending",
      fullName: "Олена Коваль",
      phone: "+380671234567",
      shippingAddress: "Київ, Відділення №12",
      paymentMethod: "cod",
      subtotal: "990.00",
      totalAmount: "990.00",
      freeShipping: false,
      itemCount: 1,
      paidAt: null,
      lines: [{ title: "Coco Mademoiselle Eau de Parfum", volumeMl: 5, quantity: 1 }],
    });
    expect(await getAccountOrder(me, theirs, testDb.db)).toBeUndefined();
    expect(await getAccountOrder(me, guest.orderId, testDb.db)).toBeUndefined();
    expect(await getAccountOrder(me, 999_999, testDb.db)).toBeUndefined();
  });
});
