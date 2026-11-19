import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CartLine } from "~/lib/cart";
import type { ProductSummary } from "~/lib/products";
import type { ProductSummaryRow } from "../db/queries/products";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import { fillUp, preselectVolume } from "./recommendations";

describe("fillUp", () => {
  const row = (publicId: string) => ({ publicId }) as ProductSummaryRow;

  it("takes each source in order, without duplicates, up to the limit", async () => {
    const asked: { exclude: readonly string[] | undefined; limit: number }[] = [];
    const rows = await fillUp({ excludePublicIds: ["self"] }, 3, [
      async (filter, limit) => {
        asked.push({ exclude: filter.excludePublicIds, limit });
        return [row("a")];
      },
      async (filter, limit) => {
        asked.push({ exclude: filter.excludePublicIds, limit });
        return [row("a"), row("self"), row("b"), row("c"), row("d")];
      },
      async () => {
        throw new Error("not asked once the list is full");
      },
    ]);
    expect(rows.map((r) => r.publicId)).toEqual(["a", "b", "c"]);
    expect(asked).toEqual([
      { exclude: ["self"], limit: 3 },
      { exclude: ["self", "a"], limit: 2 },
    ]);
  });
});

describe("preselectVolume", () => {
  const product = {
    variants: [
      { id: "v5", volumeMl: 5, price: "50.00", inStock: true },
      { id: "v10", volumeMl: 10, price: "90.00", inStock: true },
      { id: "v30", volumeMl: 30, price: "250.00", inStock: false },
    ],
    defaultVariant: { id: "v5", volumeMl: 5 },
  } as ProductSummary;

  it("preselects the size when it's in stock, else keeps the default", () => {
    expect(preselectVolume(product, 10).defaultVariant).toEqual({ id: "v10", volumeMl: 10 });
    expect(preselectVolume(product, 30).defaultVariant).toEqual({ id: "v5", volumeMl: 5 });
    expect(preselectVolume(product, null)).toBe(product);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("recommendation lists", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_recommendations_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders, products, sessions, users } = await import("../db/schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(sessions);
    await testDb.db.delete(products);
    await testDb.db.delete(users);
  });

  interface Made {
    id: number;
    publicId: string;
  }

  /** A women's perfume with 10 and 30 ml sizes (tracked, so stock can run out). */
  async function product(
    title: string,
    options: {
      active?: boolean;
      packSize?: number;
      stock?: { 10?: number; 30?: number };
      families?: string[];
      createdMinutesAgo?: number;
    } = {},
  ): Promise<Made> {
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(products)
      .values({
        title,
        brand: "House",
        gender: "women",
        fragranceFamily: options.families?.[0] ?? null,
        fragranceFamilies: options.families ?? [],
        price: "100.00",
        volumeMl: 30,
        packSize: options.packSize ?? 1,
        active: options.active ?? true,
        createdAt: new Date(Date.now() - (options.createdMinutesAgo ?? 0) * 60_000),
      })
      .returning({ id: products.id, publicId: products.publicId });
    if (!row) throw new Error("no product");
    await testDb.db.insert(productVariants).values([
      {
        productId: row.id,
        volumeMl: 10,
        price: "90.00",
        stockQuantity: options.stock?.[10] ?? 5,
        trackStock: true,
      },
      {
        productId: row.id,
        volumeMl: 30,
        price: "250.00",
        stockQuantity: options.stock?.[30] ?? 5,
        trackStock: true,
      },
    ]);
    return row;
  }

  async function recommend(from: Made, to: Made[]) {
    const { productRecommendations } = await import("../db/schema");
    await testDb.db.insert(productRecommendations).values(
      to.map((target, index) => ({
        productId: from.id,
        recommendedProductId: target.id,
        score: 1 - index / 10,
        rank: index + 1,
        signals: 3,
        computedAt: new Date(),
      })),
    );
  }

  const titles = (products: ProductSummary[]) => products.map((p) => p.title);

  async function detail(made: Made) {
    return {
      id: made.publicId,
      gender: "women" as const,
      fragranceFamilies: ["квіткові"],
      brand: "House",
    };
  }

  describe("forProduct", () => {
    it("shows the recommendations, only active, in-stock single perfumes not in the cart", async () => {
      const { forProduct } = await import("./recommendations");
      const self = await product("Self");
      const best = await product("Best");
      const archived = await product("Archived", { active: false });
      const soldOut = await product("Sold out", { stock: { 10: 0, 30: 0 } });
      const set = await product("Set", { packSize: 3 });
      const inCart = await product("In cart");
      const good = await product("Good");
      await recommend(
        self,
        [best, archived, soldOut, set, inCart, good, self].filter((p) => p !== self),
      );

      const result = await forProduct(
        self.id,
        await detail(self),
        { cartProductIds: [inCart.publicId] },
        testDb.db,
      );

      expect(result.source).toBe("recs");
      expect(titles(result.products).slice(0, 2)).toEqual(["Best", "Good"]);
      expect(titles(result.products)).not.toContain("Self");
      for (const left of ["Archived", "Sold out", "Set", "In cart"]) {
        expect(titles(result.products)).not.toContain(left);
      }
    });

    it("falls back to the similar perfumes by family without recommendations", async () => {
      const { forProduct } = await import("./recommendations");
      const self = await product("Self", { families: ["квіткові"] });
      await product("Woody", { families: ["деревні"], createdMinutesAgo: 1 });
      await product("Floral", { families: ["квіткові"], createdMinutesAgo: 2 });
      await product("Archived floral", { families: ["квіткові"], active: false });

      const result = await forProduct(self.id, await detail(self), {}, testDb.db);

      expect(result.source).toBe("similar");
      expect(titles(result.products)).toEqual(["Floral", "Woody"]);
    });
  });

  describe("forVisitor", () => {
    async function user() {
      const { users } = await import("../db/schema");
      const [row] = await testDb.db
        .insert(users)
        .values({ fullName: "Olha", email: `olha-${Math.random()}@example.com`, passwordHash: "x" })
        .returning({ id: users.id });
      if (!row) throw new Error("no user");
      return row.id;
    }

    async function bought(userId: number, made: Made) {
      const { orderItems, orders } = await import("../db/schema");
      const [row] = await testDb.db
        .insert(orders)
        .values({
          userId,
          guestFullName: "Olha",
          guestEmail: "olha@example.com",
          guestPhone: "+380501234567",
          shippingAddress: "Kyiv",
          paymentMethod: "cod",
          status: "completed",
          subtotal: "100.00",
          totalAmount: "100.00",
        })
        .returning({ id: orders.id });
      if (!row) throw new Error("no order");
      await testDb.db
        .insert(orderItems)
        .values({ orderId: row.id, productId: made.id, quantity: 1, priceAtPurchase: "100.00" });
    }

    async function viewed(anonymousId: string, made: Made) {
      const { sessions, userEvents } = await import("../db/schema");
      const [session] = await testDb.db
        .insert(sessions)
        .values({ anonymousId })
        .returning({ sessionId: sessions.sessionId });
      if (!session) throw new Error("no session");
      await testDb.db.insert(userEvents).values({
        anonymousId,
        sessionId: session.sessionId,
        eventType: "product_view",
        productId: made.id,
      });
    }

    it("is null without history", async () => {
      const { forVisitor } = await import("./recommendations");
      expect(
        await forVisitor({ userId: null, anonymousId: "nobody", trackingAllowed: true }, testDb.db),
      ).toBeNull();
    });

    it("blends the views' and orders' recommendations, without what was bought", async () => {
      const { forVisitor } = await import("./recommendations");
      const userId = await user();
      const viewedOne = await product("Viewed");
      const boughtOne = await product("Bought");
      const fromView = await product("From view");
      const fromBoth = await product("From both");
      const alreadyBought = await product("Already bought");
      await recommend(viewedOne, [fromBoth, fromView]);
      await recommend(boughtOne, [fromBoth, alreadyBought]);
      await bought(userId, boughtOne);
      await bought(userId, alreadyBought);
      await viewed("visitor", viewedOne);

      const forYou = await forVisitor(
        { userId, anonymousId: "visitor", trackingAllowed: true },
        testDb.db,
      );

      expect(forYou && titles(forYou).slice(0, 2)).toEqual(["From both", "From view"]);
      expect(forYou && titles(forYou)).not.toContain("Already bought");
      expect(forYou && titles(forYou)).not.toContain("Bought");
    });

    it("reads views only with consent", async () => {
      const { forVisitor } = await import("./recommendations");
      const viewedOne = await product("Viewed");
      await recommend(viewedOne, [await product("Other")]);
      await viewed("visitor", viewedOne);

      expect(
        await forVisitor(
          { userId: null, anonymousId: "visitor", trackingAllowed: false },
          testDb.db,
        ),
      ).toBeNull();
      expect(
        await forVisitor(
          { userId: null, anonymousId: "visitor", trackingAllowed: true },
          testDb.db,
        ),
      ).not.toBeNull();
    });
  });

  describe("forCart", () => {
    const offer = { price: "499.00", setSize: 3, volumeMl: 10 };

    function line(made: Made, quantity: number, volumeMl = 10): CartLine {
      return {
        variantId: "00000000-0000-0000-0000-000000000000",
        productId: made.publicId,
        slug: null,
        title: "",
        brand: "",
        fragranceFamily: null,
        image: null,
        packSize: 1,
        volumeMl,
        unitPrice: "90.00",
        quantity,
        stockQuantity: 5,
        lineTotal: "90.00",
      };
    }

    it("suggests perfumes with the trio size in stock while a trio is incomplete", async () => {
      const { forCart } = await import("./recommendations");
      const inCart = await product("In cart");
      const rec = await product("Recommended");
      const no10 = await product("No 10 ml", { stock: { 10: 0 } });
      await recommend(inCart, [no10, rec]);

      const result = await forCart({ lines: [line(inCart, 1)] }, offer, testDb.db);

      expect(result.missing).toBe(2);
      expect(titles(result.products)[0]).toBe("Recommended");
      expect(titles(result.products)).not.toContain("No 10 ml");
      expect(titles(result.products)).not.toContain("In cart");
      expect(result.products.every((p) => p.defaultVariant.volumeMl === 10)).toBe(true);
    });

    it("suggests nothing once the trio is complete, for big bottles or without the offer", async () => {
      const { forCart } = await import("./recommendations");
      const a = await product("A");
      await product("B");
      expect(await forCart({ lines: [line(a, 3)] }, offer, testDb.db)).toEqual({
        missing: 0,
        products: [],
      });
      expect((await forCart({ lines: [line(a, 1, 30)] }, offer, testDb.db)).missing).toBe(0);
      expect((await forCart({ lines: [line(a, 1)] }, null, testDb.db)).missing).toBe(0);
    });
  });
});
