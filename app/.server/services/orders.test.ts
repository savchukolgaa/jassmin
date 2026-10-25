import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutInput } from "~/lib/checkout";
import type { OrderStatus } from "~/lib/enums";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import { canViewOrder } from "./orders";

// Coco Mademoiselle (seed data): 7 ml for 990 UAH, 30 ml for 4450 UAH.
const COCO = "01a1652b-6e25-7c03-ae47-25b57131fb06";

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
      .select({ id: productVariants.id, productId: productVariants.productId })
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
    const seven = await variant(7, 10);
    const thirty = await variant(30, 3);
    const cart = await cartWith([
      { variant: seven, quantity: 2 },
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
          variantId: seven.id,
          volumeMl: 7,
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
    expect(await stockOf(seven.id)).toBe(8);
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
      .where(and(equals(cmsOutbox.entity, "product"), equals(cmsOutbox.entityId, seven.productId)));
    expect(products).toEqual([{ entityId: seven.productId, syncedAt: null }]);
    const after = await cartOf(cart.id);
    expect(after?.status).toBe("converted");
    expect(after?.updatedAt.getTime()).toBeGreaterThan(cart.updatedAt.getTime());
  });

  it("links a registered user's order and only gives free shipping from 1000 UAH", async () => {
    const { createOrder } = await import("./orders");
    const userId = await user();
    const seven = await variant(7, 10);

    const small = await createOrder(
      {
        cartId: (await cartWith([{ variant: seven, quantity: 1 }], userId)).id,
        userId,
        customer,
        locale: "uk",
      },
      testDb.db,
    );
    expect(small.ok).toBe(true);
    const [order] = await allOrders();
    expect(order).toMatchObject({ userId, subtotal: "990.00", freeShipping: false });

    await testDb.db.delete((await import("../db/schema")).orders);
    const exact = await cartWith([{ variant: seven, quantity: 1 }]);
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    await testDb.db
      .update(productVariants)
      .set({ price: "1000.00" })
      .where(eq(productVariants.id, seven.id));
    try {
      await createOrder({ cartId: exact.id, userId: null, customer, locale: "uk" }, testDb.db);
      expect(await allOrders()).toEqual([
        expect.objectContaining({ subtotal: "1000.00", freeShipping: true }),
      ]);
    } finally {
      await testDb.db
        .update(productVariants)
        .set({ price: "990.00" })
        .where(eq(productVariants.id, seven.id));
    }
  });

  it("changes nothing when a line asks for more than is in stock", async () => {
    const { createOrder } = await import("./orders");
    const seven = await variant(7, 10);
    const thirty = await variant(30, 1);
    const cart = await cartWith([
      { variant: seven, quantity: 2 },
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
    expect(await stockOf(seven.id)).toBe(10);
    expect(await stockOf(thirty.id)).toBe(1);
    expect((await cartOf(cart.id))?.status).toBe("active");
  });

  it("treats a line of an archived product as out of stock", async () => {
    const { createOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const seven = await variant(7, 10);
    const cart = await cartWith([{ variant: seven, quantity: 1 }]);
    await testDb.db.update(products).set({ active: false }).where(eq(products.id, seven.productId));
    try {
      expect(
        await createOrder({ cartId: cart.id, userId: null, customer, locale: "uk" }, testDb.db),
      ).toEqual({
        ok: false,
        error: "insufficient-stock",
        lines: [{ variantId: expect.any(String), available: 0 }],
      });
      expect(await stockOf(seven.id)).toBe(10);
    } finally {
      await testDb.db
        .update(products)
        .set({ active: true })
        .where(eq(products.id, seven.productId));
    }
  });

  it("rolls everything back when a later write fails", async () => {
    const { createOrder } = await import("./orders");
    const { sql } = await import("drizzle-orm");
    const seven = await variant(7, 10);
    const cart = await cartWith([{ variant: seven, quantity: 2 }]);
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
    expect(await stockOf(seven.id)).toBe(10);
    expect((await cartOf(cart.id))?.status).toBe("active");
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
    const seven = await variant(7, 10);
    const cart = await cartWith([{ variant: seven, quantity: 3 }]);
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
      subtotal: expect.any(String),
    });
    const orderId = placed?.ok ? placed.orderId : undefined;
    expect([a, b]).toContainEqual({ ok: true, orderId, placed: false });
    expect(again).toEqual({ ok: true, orderId, placed: false });
    expect(await allOrders()).toHaveLength(1);
    expect(await queuedEmails()).toEqual([expect.objectContaining({ orderId })]);
    expect(await stockOf(seven.id)).toBe(7);
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
    const seven = await variant(7, 10);
    const cart = await cartWith([{ variant: seven, quantity: 2 }], userId);
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
          volumeMl: 7,
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
    const seven = await variant(7, 50);
    const thirty = await variant(30, 50);

    const pending = await placeOrder(me, [{ variant: seven, quantity: 1 }]);
    const shipped = await placeOrder(me, [
      { variant: seven, quantity: 2 },
      { variant: thirty, quantity: 1 },
    ]);
    const completed = await placeOrder(me, [{ variant: thirty, quantity: 1 }]);
    const cancelled = await placeOrder(me, [{ variant: seven, quantity: 1 }]);
    await placeOrder(other, [{ variant: seven, quantity: 1 }]);
    await placeOrder(null, [{ variant: seven, quantity: 1 }]);
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
        { volumeMl: 7, quantity: 2, unitPrice: "990.00", lineTotal: "1980.00" },
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
    const seven = await variant(7, 10);
    const orderId = await placeOrder(me, [{ variant: seven, quantity: 2 }]);

    await testDb.db
      .update(productVariants)
      .set({ price: "1500.00" })
      .where(eq(productVariants.id, seven.id));
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
        .where(eq(productVariants.id, seven.id));
    }
  });

  it("shows an order's details only to the user who placed it", async () => {
    const { getAccountOrder } = await import("./orders");
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../db/schema");
    const me = await user();
    const other = await user();
    const seven = await variant(7, 10);
    const mine = await placeOrder(me, [{ variant: seven, quantity: 1 }]);
    const theirs = await placeOrder(other, [{ variant: seven, quantity: 1 }]);
    // A guest order placed with my email isn't mine (linking guest orders is out of scope).
    const [account] = await testDb.db.select().from(users).where(eq(users.id, me));
    const { createOrder } = await import("./orders");
    const guestCart = await cartWith([{ variant: seven, quantity: 1 }]);
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
      lines: [{ title: "Coco Mademoiselle Eau de Parfum", volumeMl: 7, quantity: 1 }],
    });
    expect(await getAccountOrder(me, theirs, testDb.db)).toBeUndefined();
    expect(await getAccountOrder(me, guest.orderId, testDb.db)).toBeUndefined();
    expect(await getAccountOrder(me, 999_999, testDb.db)).toBeUndefined();
  });
});
