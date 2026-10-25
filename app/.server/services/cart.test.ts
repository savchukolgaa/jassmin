import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

// Coco Mademoiselle (seed data): 7 ml in stock 10, 30 ml in stock 3, 10 ml sold out.
const COCO = "01a1652b-6e25-7c03-ae47-25b57131fb06";
// Sauvage (seed data): 10 ml at 790 ₴, 15 in stock.
const SAUVAGE = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";

beforeAll(() => {
  // `services/cart` imports the auth session, which validates the env on import.
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cart service", () => {
  let testDb: TestDatabase;
  let emailCounter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    testDb = await createTestDatabase("jassmin_cart_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { carts } = await import("../db/schema");
    await testDb.db.delete(carts);
  });

  /** A seeded size (of Coco Mademoiselle by default), as `checkVariantForCart` returns it. */
  async function variant(volumeMl: number, product = COCO) {
    const { and, eq } = await import("drizzle-orm");
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .select({
        id: productVariants.id,
        publicId: productVariants.publicId,
        productId: productVariants.productId,
        volumeMl: productVariants.volumeMl,
        stockQuantity: productVariants.stockQuantity,
        price: productVariants.price,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.publicId, product), eq(productVariants.volumeMl, volumeMl)));
    if (!row) throw new Error(`No ${volumeMl} ml variant`);
    return row;
  }

  /** A guest with an analytics session, as `getVisitor` returns them. */
  async function guest(anonymousId = crypto.randomUUID()) {
    const { sessions } = await import("../db/schema");
    const [session] = await testDb.db.insert(sessions).values({ anonymousId }).returning();
    return { userId: null, anonymousId, sessionId: session?.sessionId ?? "" };
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

  async function cartRows() {
    const { carts } = await import("../db/schema");
    return testDb.db.select().from(carts);
  }

  it("creates one guest cart tied to the session and adds up repeated adds", async () => {
    const cart = await import("./cart");
    const visitor = await guest();
    const small = await variant(7);

    const added = (quantityDelta: number) => ({
      ok: true,
      change: { productId: small.productId, volumeMl: 7, quantityDelta },
    });
    expect(await cart.addItem(visitor, small, 1, testDb.db)).toEqual(added(1));
    expect(await cart.addItem(visitor, small, 2, testDb.db)).toEqual(added(2));

    const rows = await cartRows();
    expect(rows).toEqual([
      expect.objectContaining({ userId: null, sessionId: visitor.sessionId, status: "active" }),
    ]);
    const view = await cart.getCartView(visitor, testDb.db);
    expect(view.lines).toEqual([
      expect.objectContaining({
        variantId: small.publicId,
        productId: COCO,
        volumeMl: 7,
        unitPrice: "990.00",
        quantity: 3,
        lineTotal: "2970.00",
      }),
    ]);
    expect(view).toMatchObject({ itemCount: 3, subtotal: "2970.00" });
    expect(await cart.getCartCount(visitor, testDb.db)).toBe(3);
  });

  it("keeps a guest's cart when they come back in a new session", async () => {
    const cart = await import("./cart");
    const first = await guest();
    await cart.addItem(first, await variant(7), 1, testDb.db);

    const later = await guest(first.anonymousId);

    expect(await cart.getCartCount(later, testDb.db)).toBe(1);
    expect(await cart.getCartCount({ userId: null }, testDb.db)).toBe(0);
    expect(await cart.getCartCount(await guest(), testDb.db)).toBe(0);
  });

  it("never lets a line exceed the variant's stock", async () => {
    const cart = await import("./cart");
    const visitor = await guest();
    const thirty = await variant(30);

    expect(await cart.addItem(visitor, thirty, 4, testDb.db)).toEqual({
      ok: false,
      error: "exceeds-stock",
      available: 3,
    });
    await cart.addItem(visitor, thirty, 2, testDb.db);
    expect(await cart.addItem(visitor, thirty, 2, testDb.db)).toMatchObject({
      error: "exceeds-stock",
    });
    expect(await cart.updateQuantity(visitor, thirty.publicId, 4, testDb.db)).toMatchObject({
      error: "exceeds-stock",
      available: 3,
    });
    expect(await cart.updateQuantity(visitor, thirty.publicId, 3, testDb.db)).toEqual({
      ok: true,
      change: { productId: thirty.productId, volumeMl: 30, quantityDelta: 1 },
    });
    expect(await cart.getCartCount(visitor, testDb.db)).toBe(3);
  });

  it("updates and removes lines and bumps updated_at on every change", async () => {
    const cart = await import("./cart");
    const visitor = await guest();
    const small = await variant(7);
    const big = await variant(100);
    await cart.addItem(visitor, small, 1, testDb.db);
    const { carts } = await import("../db/schema");
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Backdates the cart, then reports whether the change moved `updated_at` forward again.
    const bumps = async (change: () => Promise<unknown>) => {
      await testDb.db.update(carts).set({ updatedAt: anHourAgo });
      await change();
      return ((await cartRows())[0]?.updatedAt.getTime() ?? 0) > anHourAgo.getTime();
    };

    expect(await bumps(() => cart.addItem(visitor, big, 1, testDb.db))).toBe(true);
    expect(await bumps(() => cart.updateQuantity(visitor, small.publicId, 5, testDb.db))).toBe(
      true,
    );
    expect(await bumps(() => cart.removeItem(visitor, big.publicId, testDb.db))).toBe(true);

    const view = await cart.getCartView(visitor, testDb.db);
    expect(view.lines.map((l) => [l.volumeMl, l.quantity])).toEqual([[7, 5]]);
    expect(await cart.removeItem(visitor, big.publicId, testDb.db)).toEqual({
      ok: false,
      error: "not-in-cart",
    });
  });

  it("reports the units each change added or removed", async () => {
    const cart = await import("./cart");
    const visitor = await guest();
    const small = await variant(7);
    const change = (quantityDelta: number) => ({
      ok: true,
      change: { productId: small.productId, volumeMl: 7, quantityDelta },
    });
    await cart.addItem(visitor, small, 2, testDb.db);

    expect(await cart.updateQuantity(visitor, small.publicId, 5, testDb.db)).toEqual(change(3));
    expect(await cart.updateQuantity(visitor, small.publicId, 1, testDb.db)).toEqual(change(-4));
    expect(await cart.updateQuantity(visitor, small.publicId, 1, testDb.db)).toEqual(change(0));
    expect(await cart.removeItem(visitor, small.publicId, testDb.db)).toEqual(change(-1));
  });

  it("only changes lines in the owner's own cart", async () => {
    const cart = await import("./cart");
    const owner = await guest();
    const stranger = await guest();
    const small = await variant(7);
    await cart.addItem(owner, small, 1, testDb.db);
    await cart.addItem(stranger, await variant(30), 1, testDb.db);

    expect(await cart.updateQuantity(stranger, small.publicId, 2, testDb.db)).toEqual({
      ok: false,
      error: "not-in-cart",
    });
    expect(await cart.removeItem(await guest(), small.publicId, testDb.db)).toEqual({
      ok: false,
      error: "not-in-cart",
    });
    expect(await cart.getCartCount(owner, testDb.db)).toBe(1);
  });

  it("creates a single cart for concurrent first adds", async () => {
    const cart = await import("./cart");
    const visitor = await guest();

    const ids = await Promise.all([
      cart.getOrCreateActiveCart(visitor, testDb.db),
      cart.getOrCreateActiveCart(visitor, testDb.db),
      cart.getOrCreateActiveCart(visitor, testDb.db),
    ]);

    expect(new Set(ids).size).toBe(1);
    expect(await cartRows()).toHaveLength(1);
  });

  it("keeps a logged-in user's cart by user id", async () => {
    const cart = await import("./cart");
    const visitor = await guest();
    const userId = await user();
    await cart.addItem({ ...visitor, userId }, await variant(7), 2, testDb.db);

    expect(await cartRows()).toEqual([
      expect.objectContaining({ userId, sessionId: visitor.sessionId }),
    ]);
    expect(await cart.getCartCount({ userId }, testDb.db)).toBe(2);
    // The same browser logged out is a guest with an empty cart.
    expect(await cart.getCartCount({ ...visitor, userId: null }, testDb.db)).toBe(0);
  });

  describe("mergeGuestCart", () => {
    it("adopts the guest cart when the user has none", async () => {
      const cart = await import("./cart");
      const visitor = await guest();
      const userId = await user();
      await cart.addItem(visitor, await variant(7), 2, testDb.db);

      await cart.mergeGuestCart(userId, visitor.anonymousId, testDb.db);

      expect(await cartRows()).toEqual([expect.objectContaining({ userId, status: "active" })]);
      expect(await cart.getCartCount({ userId }, testDb.db)).toBe(2);
      expect(await cart.getCartCount(visitor, testDb.db)).toBe(0);
    });

    it("adds the guest lines to the user's cart, capped at stock, and deletes the guest cart", async () => {
      const cart = await import("./cart");
      const visitor = await guest();
      const userId = await user();
      const userWriter = { ...(await guest()), userId };
      const small = await variant(7);
      const thirty = await variant(30);
      const fifty = await variant(50);
      await cart.addItem(userWriter, thirty, 2, testDb.db);
      await cart.addItem(userWriter, small, 1, testDb.db);
      await cart.addItem(visitor, thirty, 2, testDb.db);
      await cart.addItem(visitor, fifty, 1, testDb.db);

      await cart.mergeGuestCart(userId, visitor.anonymousId, testDb.db);

      expect(await cartRows()).toEqual([expect.objectContaining({ userId })]);
      const view = await cart.getCartView({ userId }, testDb.db);
      expect(view.lines.map((l) => [l.volumeMl, l.quantity])).toEqual([
        [30, 3],
        [7, 1],
        [50, 1],
      ]);
    });

    it("drops guest lines whose size has sold out since", async () => {
      const { eq } = await import("drizzle-orm");
      const { productVariants } = await import("../db/schema");
      const cart = await import("./cart");
      const visitor = await guest();
      const userId = await user();
      const big = await variant(100);
      await cart.addItem({ ...(await guest()), userId }, await variant(7), 1, testDb.db);
      await cart.addItem(visitor, big, 1, testDb.db);
      await testDb.db
        .update(productVariants)
        .set({ stockQuantity: 0 })
        .where(eq(productVariants.id, big.id));

      try {
        await cart.mergeGuestCart(userId, visitor.anonymousId, testDb.db);

        const view = await cart.getCartView({ userId }, testDb.db);
        expect(view.lines.map((l) => l.volumeMl)).toEqual([7]);
      } finally {
        await testDb.db
          .update(productVariants)
          .set({ stockQuantity: big.stockQuantity })
          .where(eq(productVariants.id, big.id));
      }
    });

    it("does nothing without a guest cart", async () => {
      const cart = await import("./cart");
      const userId = await user();
      await cart.addItem({ ...(await guest()), userId }, await variant(7), 1, testDb.db);

      await cart.mergeGuestCart(userId, crypto.randomUUID(), testDb.db);

      expect(await cart.getCartCount({ userId }, testDb.db)).toBe(1);
    });
  });

  describe("promo codes and discounts (#59)", () => {
    beforeEach(async () => {
      const { discounts } = await import("../db/schema");
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

    const trio: NewDiscount = {
      slug: "tester-trio",
      kind: "fixed_price_set",
      value: "499",
      scopeVolumesMl: [10],
      scopePackSize: 1,
      minQuantity: 3,
      maxSets: 3,
    };

    it("applies the trio by itself and a promo code once the trio no longer does", async () => {
      const cart = await import("./cart");
      await insertDiscount(trio);
      await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
      const visitor = await guest();
      const tenMl = await variant(10, SAUVAGE);
      await cart.addItem(visitor, tenMl, 3, testDb.db);

      expect(await cart.getCartView(visitor, testDb.db)).toMatchObject({
        subtotal: "2370.00",
        discount: { amount: "1871.00", code: null, kind: "fixed_price_set" },
        total: "499.00",
        promo: null,
      });

      // The trio saves more, so the code is kept but not used.
      expect(await cart.applyPromoCode(visitor, "JASSMIN10", testDb.db)).toEqual({
        ok: true,
        status: "not-best",
      });
      expect(await cart.getCartView(visitor, testDb.db)).toMatchObject({
        total: "499.00",
        promo: { code: "JASSMIN10", status: "not-best" },
      });

      await cart.updateQuantity(visitor, tenMl.publicId, 1, testDb.db);
      expect(await cart.getCartView(visitor, testDb.db)).toMatchObject({
        subtotal: "790.00",
        discount: { amount: "79.00", code: "JASSMIN10", kind: "percent" },
        total: "711.00",
        promo: { code: "JASSMIN10", status: "applied" },
      });
    });

    it("refuses unknown, expired, used-up and inapplicable codes without storing them", async () => {
      const cart = await import("./cart");
      await insertDiscount({ slug: "ended", code: "EXPIRED5", endsAt: new Date(Date.now() - 1) });
      await insertDiscount({
        slug: "used",
        code: "USEDUP",
        maxRedemptions: 1,
        redemptionCount: 1,
      });
      await insertDiscount({
        slug: "later",
        code: "SOON",
        startsAt: new Date(Date.now() + 60_000),
      });
      await insertDiscount({ slug: "big", code: "BIG50ML", scopeVolumesMl: [50] });
      const visitor = await guest();
      await cart.addItem(visitor, await variant(7), 1, testDb.db);

      for (const [code, error] of [
        ["NOPE", "promo-invalid"],
        ["SOON", "promo-invalid"],
        ["EXPIRED5", "promo-expired"],
        ["USEDUP", "promo-used-up"],
        ["BIG50ML", "promo-not-applicable"],
      ] as const) {
        expect(await cart.applyPromoCode(visitor, code, testDb.db)).toEqual({ ok: false, error });
      }
      expect(await cart.getCartView(visitor, testDb.db)).toMatchObject({
        subtotal: "990.00",
        discount: null,
        total: "990.00",
        promo: null,
      });
      // No cart, nothing to apply it to.
      expect(await cart.applyPromoCode(await guest(), "BIG50ML", testDb.db)).toEqual({
        ok: false,
        error: "promo-not-applicable",
      });
    });

    it("keeps a stored code that stops applying and says why, until it's removed", async () => {
      const cart = await import("./cart");
      await insertDiscount({ slug: "thirty", code: "THIRTY", scopeVolumesMl: [30] });
      const visitor = await guest();
      const thirty = await variant(30);
      await cart.addItem(visitor, thirty, 1, testDb.db);
      expect(await cart.applyPromoCode(visitor, "THIRTY", testDb.db)).toEqual({
        ok: true,
        status: "applied",
      });

      await cart.removeItem(visitor, thirty.publicId, testDb.db);
      await cart.addItem(visitor, await variant(7), 1, testDb.db);
      expect(await cart.getCartView(visitor, testDb.db)).toMatchObject({
        discount: null,
        total: "990.00",
        promo: { code: "THIRTY", status: "not-applicable" },
      });

      await cart.removePromoCode(visitor, testDb.db);
      expect((await cart.getCartView(visitor, testDb.db)).promo).toBeNull();
    });

    it("brings the guest's code to the user's cart unless it has its own", async () => {
      const cart = await import("./cart");
      await insertDiscount({ slug: "welcome", code: "JASSMIN10" });
      await insertDiscount({ slug: "other", code: "OTHER5", value: "5" });
      const small = await variant(7);

      const visitor = await guest();
      const userId = await user();
      await cart.addItem(visitor, small, 1, testDb.db);
      await cart.applyPromoCode(visitor, "JASSMIN10", testDb.db);
      await cart.addItem({ ...(await guest()), userId }, small, 1, testDb.db);
      await cart.mergeGuestCart(userId, visitor.anonymousId, testDb.db);
      expect((await cart.getCartView({ userId }, testDb.db)).promo?.code).toBe("JASSMIN10");

      const second = await guest();
      await cart.addItem(second, small, 1, testDb.db);
      await cart.applyPromoCode(second, "OTHER5", testDb.db);
      await cart.mergeGuestCart(userId, second.anonymousId, testDb.db);
      expect((await cart.getCartView({ userId }, testDb.db)).promo?.code).toBe("JASSMIN10");
    });
  });

  describe("abandoned carts (#19)", () => {
    /** Marks the cart abandoned the way the job does. */
    async function abandon(cartId: number) {
      const { sql } = await import("drizzle-orm");
      await testDb.db.execute(
        sql`update carts set status = 'abandoned', abandoned_at = now() where id = ${cartId}`,
      );
    }

    /**
     * Holds the cart's row lock until `write` waits for it, then abandons the cart and lets the
     * write go on: the job running between a write's lookup and its lock.
     */
    async function abandonDuring<T>(cartId: number, write: () => Promise<T>): Promise<T> {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: testDb.db.$client.options.connectionString });
      await client.connect();
      try {
        await client.query("begin");
        await client.query("select 1 from carts where id = $1 for update", [cartId]);
        const pending = write();
        let blocked = false;
        for (let i = 0; i < 400 && !blocked; i++) {
          const { rows } = await client.query<{ n: number }>(
            `select count(*)::int as n from pg_stat_activity
             where datname = current_database() and wait_event_type = 'Lock'`,
          );
          blocked = (rows[0]?.n ?? 0) > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        await client.query(
          "update carts set status = 'abandoned', abandoned_at = now() where id = $1",
          [cartId],
        );
        await client.query("commit");
        return await pending;
      } finally {
        await client.end();
      }
    }

    async function onlyCartId() {
      const [row] = await cartRows();
      if (!row) throw new Error("No cart");
      return row.id;
    }

    it("reports whether the locked cart is still active", async () => {
      const cart = await import("./cart");
      const { lockCart } = await import("../db/queries/cart");
      await cart.addItem(await guest(), await variant(7), 1, testDb.db);
      const cartId = await onlyCartId();

      expect(await testDb.db.transaction((tx) => lockCart(tx, cartId))).toBe(true);
      await abandon(cartId);
      expect(await testDb.db.transaction((tx) => lockCart(tx, cartId))).toBe(false);
    });

    it("gives a returning shopper a new, empty cart", async () => {
      const cart = await import("./cart");
      const userId = await user();
      const shopper = { ...(await guest()), userId };
      await cart.addItem(shopper, await variant(7), 2, testDb.db);
      const oldId = await onlyCartId();
      await abandon(oldId);

      expect(await cart.getCartView(shopper, testDb.db)).toMatchObject({ lines: [], itemCount: 0 });
      expect(await cart.addItem(shopper, await variant(30), 1, testDb.db)).toMatchObject({
        ok: true,
        change: { volumeMl: 30, quantityDelta: 1 },
      });

      const rows = await cartRows();
      expect(rows.map((r) => [r.id === oldId, r.status]).sort()).toEqual([
        [false, "active"],
        [true, "abandoned"],
      ]);
      const view = await cart.getCartView(shopper, testDb.db);
      expect(view.lines.map((l) => [l.volumeMl, l.quantity])).toEqual([[30, 1]]);
    });

    it("adds to a new cart when the job abandons the cart during an add", async () => {
      const cart = await import("./cart");
      const visitor = await guest();
      const small = await variant(7);
      await cart.addItem(visitor, small, 1, testDb.db);
      const oldId = await onlyCartId();

      const result = await abandonDuring(oldId, () => cart.addItem(visitor, small, 2, testDb.db));

      expect(result).toEqual({
        ok: true,
        change: { productId: small.productId, volumeMl: 7, quantityDelta: 2 },
      });
      const rows = await cartRows();
      expect(rows.find((r) => r.id === oldId)?.status).toBe("abandoned");
      expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
      // The abandoned cart keeps its line as it was; the new cart has only the new add.
      expect((await cart.getCartView(visitor, testDb.db)).itemCount).toBe(2);
    });

    it("doesn't change lines of a cart the job abandons during the change", async () => {
      const cart = await import("./cart");
      const visitor = await guest();
      const small = await variant(7);
      await cart.addItem(visitor, small, 1, testDb.db);
      const cartId = await onlyCartId();

      const updated = await abandonDuring(cartId, () =>
        cart.updateQuantity(visitor, small.publicId, 2, testDb.db),
      );

      expect(updated).toEqual({ ok: false, error: "not-in-cart" });
      const { eq } = await import("drizzle-orm");
      const { cartItems } = await import("../db/schema");
      const lines = await testDb.db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
      expect(lines.map((l) => l.quantity)).toEqual([1]);
    });

    it("doesn't remove lines of a cart the job abandons during the removal", async () => {
      const cart = await import("./cart");
      const visitor = await guest();
      const small = await variant(7);
      await cart.addItem(visitor, small, 1, testDb.db);
      const cartId = await onlyCartId();

      const removed = await abandonDuring(cartId, () =>
        cart.removeItem(visitor, small.publicId, testDb.db),
      );

      expect(removed).toEqual({ ok: false, error: "not-in-cart" });
      const { eq } = await import("drizzle-orm");
      const { cartItems } = await import("../db/schema");
      expect(
        await testDb.db.select().from(cartItems).where(eq(cartItems.cartId, cartId)),
      ).toHaveLength(1);
    });
  });
});
