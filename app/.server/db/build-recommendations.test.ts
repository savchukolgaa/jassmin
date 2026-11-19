import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "~/lib/enums";
import { computeItemCosine, parseMinSignals } from "./build-recommendations";
import { hasDatabase, type TestDatabase } from "./test-utils";

const A = 1;
const B = 2;
const C = 3;

// Two customers who bought (weight 3) and two sessions that viewed (weight 1):
//   c1: {A, B}   c2: {A, C}   s1: {A, B}   s2: {B, C}
// ‖A‖² = 9 + 9 + 1 = 19, ‖B‖² = 9 + 1 + 1 = 11, ‖C‖² = 9 + 1 = 10
// A·B = 3·3 + 1·1 = 10, A·C = 3·3 = 9, B·C = 1·1 = 1
// sim(A, B) = 10 / √209 ≈ 0.6917, sim(A, C) = 9 / √190 ≈ 0.6529, sim(B, C) = 1 / √110 ≈ 0.0953
const EXAMPLE = [
  { basket: "c:1", productId: A, weight: 3 },
  { basket: "c:1", productId: B, weight: 3 },
  { basket: "c:2", productId: A, weight: 3 },
  { basket: "c:2", productId: C, weight: 3 },
  { basket: "s:1", productId: A, weight: 1 },
  { basket: "s:1", productId: B, weight: 1 },
  { basket: "s:2", productId: B, weight: 1 },
  { basket: "s:2", productId: C, weight: 1 },
];

type Rows = ReturnType<typeof computeItemCosine>["rows"];

function scoreOf(rows: Rows, from: number, to: number) {
  return rows.find((row) => row.productId === from && row.recommendedProductId === to)?.score;
}

describe("computeItemCosine", () => {
  it("matches the hand-computed cosine similarities", () => {
    const { rows, products, eligible } = computeItemCosine(EXAMPLE, { minSignals: 1 });
    expect(products).toBe(3);
    expect(eligible).toBe(3);
    expect(scoreOf(rows, A, B)).toBeCloseTo(10 / Math.sqrt(19 * 11), 10);
    expect(scoreOf(rows, A, B)).toBeCloseTo(0.6917, 4);
    expect(scoreOf(rows, A, C)).toBeCloseTo(0.6529, 4);
    expect(scoreOf(rows, B, C)).toBeCloseTo(0.0953, 4);
    // Symmetric.
    expect(scoreOf(rows, B, A)).toBe(scoreOf(rows, A, B));
    expect(scoreOf(rows, C, B)).toBe(scoreOf(rows, B, C));
  });

  it("ranks each product's recommendations, best first, with the shared baskets", () => {
    const { rows } = computeItemCosine(EXAMPLE, { minSignals: 1 });
    expect(
      rows
        .filter((row) => row.productId === A)
        .map(({ recommendedProductId, rank, signals }) => ({
          recommendedProductId,
          rank,
          signals,
        })),
    ).toEqual([
      { recommendedProductId: B, rank: 1, signals: 2 },
      { recommendedProductId: C, rank: 2, signals: 1 },
    ]);
    expect(rows.some((row) => row.productId === row.recommendedProductId)).toBe(false);
  });

  it("counts a product once per basket, at its highest weight", () => {
    const repeated = computeItemCosine(
      [
        ...EXAMPLE,
        { basket: "s:1", productId: A, weight: 1 },
        { basket: "c:1", productId: B, weight: 1 },
      ],
      { minSignals: 1 },
    );
    expect(scoreOf(repeated.rows, A, B)).toBeCloseTo(0.6917, 4);
  });

  it("leaves out products with fewer baskets than minSignals", () => {
    // A is in 3 baskets, B in 3, C in 2.
    const { rows, eligible } = computeItemCosine(EXAMPLE, { minSignals: 3 });
    expect(eligible).toBe(2);
    expect(new Set(rows.map((row) => row.productId))).toEqual(new Set([A, B]));
    // C can still be recommended for the others.
    expect(scoreOf(rows, A, C)).toBeCloseTo(0.6529, 4);
  });

  it("keeps only the top N per product", () => {
    const { rows } = computeItemCosine(EXAMPLE, { minSignals: 1, topN: 1 });
    expect(rows.filter((row) => row.productId === A)).toHaveLength(1);
    expect(rows.find((row) => row.productId === A)?.recommendedProductId).toBe(B);
  });

  it("returns nothing without signals or without co-occurrences", () => {
    expect(computeItemCosine([], { minSignals: 1 })).toEqual({
      rows: [],
      products: 0,
      eligible: 0,
    });
    const alone = computeItemCosine(
      [
        { basket: "s:1", productId: A, weight: 1 },
        { basket: "s:2", productId: B, weight: 1 },
      ],
      { minSignals: 1 },
    );
    expect(alone.rows).toEqual([]);
    expect(alone.products).toBe(2);
  });
});

describe("parseMinSignals", () => {
  it("defaults to 5 and reads a positive whole number", () => {
    expect(parseMinSignals({})).toEqual({ ok: true, minSignals: 5 });
    expect(parseMinSignals({ RECS_MIN_SIGNALS: "" })).toEqual({ ok: true, minSignals: 5 });
    expect(parseMinSignals({ RECS_MIN_SIGNALS: "2" })).toEqual({ ok: true, minSignals: 2 });
  });

  it("refuses anything else", () => {
    for (const value of ["0", "-1", "1.5", "many"]) {
      expect(parseMinSignals({ RECS_MIN_SIGNALS: value }).ok).toBe(false);
    }
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("buildRecommendationsJob", () => {
  let testDb: TestDatabase;
  const now = new Date("2026-11-19T02:45:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_build_recommendations_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders, products, sessions } = await import("./schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(sessions);
    await testDb.db.delete(products);
  });

  async function product(title: string) {
    const { products } = await import("./schema");
    const [row] = await testDb.db
      .insert(products)
      .values({ title, brand: "House", gender: "women", price: "100.00", volumeMl: 30 })
      .returning({ id: products.id });
    if (!row) throw new Error("no product");
    return row.id;
  }

  async function order(email: string, status: OrderStatus, productIds: number[], at = daysAgo(1)) {
    const { orderItems, orders } = await import("./schema");
    const [row] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "Olha",
        guestEmail: email,
        guestPhone: "+380501234567",
        shippingAddress: "Kyiv",
        paymentMethod: "cod",
        status,
        subtotal: "100.00",
        totalAmount: "100.00",
        createdAt: at,
      })
      .returning({ id: orders.id });
    if (!row) throw new Error("no order");
    await testDb.db.insert(orderItems).values(
      productIds.map((productId) => ({
        orderId: row.id,
        productId,
        quantity: 1,
        priceAtPurchase: "100.00",
      })),
    );
  }

  async function views(productIds: number[], at = daysAgo(1)) {
    const { sessions, userEvents } = await import("./schema");
    const [session] = await testDb.db
      .insert(sessions)
      .values({ anonymousId: "visitor", startedAt: at })
      .returning({ sessionId: sessions.sessionId });
    if (!session) throw new Error("no session");
    await testDb.db.insert(userEvents).values(
      productIds.map((productId) => ({
        anonymousId: "visitor",
        sessionId: session.sessionId,
        eventType: "product_view" as const,
        productId,
        createdAt: at,
      })),
    );
  }

  async function storedRows() {
    const { productRecommendations } = await import("./schema");
    const rows = await testDb.db.select().from(productRecommendations);
    return rows
      .map(({ productId, recommendedProductId, rank, signals }) => ({
        productId,
        recommendedProductId,
        rank,
        signals,
      }))
      .sort((x, y) => x.productId - y.productId || x.rank - y.rank);
  }

  it("builds the hand-computed example from sold orders and views", async () => {
    const { buildRecommendationsJob } = await import("./build-recommendations");
    const a = await product("A");
    const b = await product("B");
    const c = await product("C");
    await order("one@example.com", "paid", [a, b]);
    // The same guest's later order is the same basket, whatever the email's case.
    await order("ONE@example.com", "completed", [a]);
    await order("two@example.com", "shipped", [a, c]);
    await views([a, b]);
    await views([b, c]);

    const result = await buildRecommendationsJob(testDb.db, { now, minSignals: 1 });

    expect(result.message).toBe(
      "Recommendations for 3 of 3 products with signals (at least 1 each): 6 rows.",
    );
    const { productRecommendations } = await import("./schema");
    const rows = await testDb.db.select().from(productRecommendations);
    const score = (from: number, to: number) =>
      rows.find((row) => row.productId === from && row.recommendedProductId === to)?.score;
    expect(score(a, b)).toBeCloseTo(0.6917, 4);
    expect(score(a, c)).toBeCloseTo(0.6529, 4);
    expect(score(b, c)).toBeCloseTo(0.0953, 4);
    expect(rows.every((row) => row.computedAt.getTime() === now.getTime())).toBe(true);
  });

  it("ignores unsold orders and anything older than a year, and replaces the table", async () => {
    const { buildRecommendationsJob } = await import("./build-recommendations");
    const a = await product("A");
    const b = await product("B");
    const c = await product("C");
    await order("one@example.com", "paid", [a, b]);
    for (const status of ["pending", "cancelled", "returned", "unclaimed"] as const) {
      await order(`${status}@example.com`, status, [a, c]);
    }
    await order("old@example.com", "completed", [a, c], daysAgo(366));
    await views([b, c], daysAgo(400));

    await buildRecommendationsJob(testDb.db, { now, minSignals: 1 });
    expect(await storedRows()).toEqual([
      { productId: a, recommendedProductId: b, rank: 1, signals: 1 },
      { productId: b, recommendedProductId: a, rank: 1, signals: 1 },
    ]);

    // A second run replaces the rows instead of adding to them.
    await buildRecommendationsJob(testDb.db, { now, minSignals: 1 });
    expect(await storedRows()).toHaveLength(2);

    // Without enough signals, the table empties.
    const empty = await buildRecommendationsJob(testDb.db, { now, minSignals: 5 });
    expect(empty.eligible).toBe(0);
    expect(await storedRows()).toEqual([]);
  });
});
