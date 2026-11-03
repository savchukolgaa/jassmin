import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("popular perfumes (#67)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_popular_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders, products } = await import("../db/schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(products);
  });

  /** A product with one 30 ml size, created `minutesAgo` minutes ago. */
  async function product(
    title: string,
    options: {
      rank?: number;
      minutesAgo?: number;
      active?: boolean;
      variants?: boolean;
      /** Primary first. */
      families?: string[];
      gender?: "women" | "men" | "unisex";
    } = {},
  ) {
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(products)
      .values({
        title,
        brand: "House",
        gender: options.gender ?? "women",
        fragranceFamily: options.families?.[0] ?? null,
        fragranceFamilies: options.families ?? [],
        popularRank: options.rank ?? null,
        price: "100.00",
        volumeMl: 30,
        active: options.active ?? true,
        createdAt: new Date(Date.now() - (options.minutesAgo ?? 0) * 60_000),
      })
      .returning({ id: products.id });
    if (!row) throw new Error("no product");
    if (options.variants !== false) {
      await testDb.db
        .insert(productVariants)
        .values({ productId: row.id, volumeMl: 30, price: "100.00", stockQuantity: 5 });
    }
    return row.id;
  }

  /** A paid order with `quantity` units of the product. */
  async function sold(productId: number, quantity: number) {
    const { orderItems, orders } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "Olha",
        guestEmail: "olha@example.com",
        guestPhone: "+380501234567",
        shippingAddress: "Kyiv",
        paymentMethod: "cod",
        status: "paid",
        subtotal: "100.00",
        totalAmount: "100.00",
      })
      .returning({ id: orders.id });
    if (!row) throw new Error("no order");
    await testDb.db
      .insert(orderItems)
      .values({ orderId: row.id, productId, quantity, priceAtPurchase: "100.00" });
  }

  async function popular(families: string[] = [], page = 1, gender: "women" | "men" | null = null) {
    const { getPopularPage } = await import("./products");
    const result = await getPopularPage({ families, gender }, page, testDb.db);
    return { ...result, titles: result.products.map((p) => p.title) };
  }

  it("lists the ranked products in staff order, ahead of better sellers", async () => {
    await product("Third", { rank: 3 });
    await product("First", { rank: 1 });
    const seller = await product("Seller");
    await product("Second", { rank: 2 });
    await sold(seller, 10);

    expect((await popular()).titles).toEqual(["First", "Second", "Third", "Seller"]);
  });

  it("tops up with unranked products by units sold, then newest, without repeats", async () => {
    await product("Ranked", { rank: 1 });
    await product("Old", { minutesAgo: 30 });
    await product("New", { minutesAgo: 1 });
    const seller = await product("Seller", { minutesAgo: 60 });
    await sold(seller, 2);

    const result = await popular();
    expect(result.titles).toEqual(["Ranked", "Seller", "New", "Old"]);
    expect(result).toMatchObject({ total: 4, page: 1, pageCount: 1 });
  });

  it("carries each product's sizes for the card's volume picker (#74)", async () => {
    await product("First", { rank: 1 });
    const [first] = (await popular()).products;

    expect(first?.variants).toEqual([
      { id: first?.defaultVariant.id, volumeMl: 30, price: "100.00", inStock: true },
    ]);
  });

  it("orders equal ranks by sales", async () => {
    await product("Tied A", { rank: 1, minutesAgo: 5 });
    const b = await product("Tied B", { rank: 1, minutesAgo: 10 });
    await sold(b, 1);

    expect((await popular()).titles).toEqual(["Tied B", "Tied A"]);
  });

  it("tops up only the first page and pages through the ranked products", async () => {
    for (let rank = 1; rank <= 14; rank += 1) {
      await product(`Ranked ${rank}`, { rank });
    }
    await product("Unranked");

    const first = await popular();
    expect(first).toMatchObject({ total: 14, page: 1, pageCount: 2 });
    expect(first.titles).toHaveLength(12);
    expect(first.titles[0]).toBe("Ranked 1");

    const second = await popular([], 2);
    expect(second.titles).toEqual(["Ranked 13", "Ranked 14"]);
  });

  it("fills one page from the bestsellers when nothing is ranked", async () => {
    for (let i = 0; i < 15; i += 1) {
      await product(`Product ${i}`, { minutesAgo: i });
    }

    const result = await popular();
    expect(result).toMatchObject({ total: 12, pageCount: 1 });
    expect(result.titles[0]).toBe("Product 0");
  });

  it("shows the last page for a page past the end", async () => {
    await product("Only", { rank: 1 });

    expect(await popular([], 9)).toMatchObject({ page: 1, pageCount: 1, titles: ["Only"] });
  });

  it("leaves out inactive and size-less products, and lists every gender", async () => {
    await product("Archived", { rank: 1, active: false });
    await product("No sizes", { rank: 2, variants: false });
    await product("Women", { rank: 3 });
    await product("Men", { rank: 4, gender: "men" });
    await product("Unisex", { rank: 5, gender: "unisex" });

    const result = await popular();
    expect(result.titles).toEqual(["Women", "Men", "Unisex"]);
    expect(result.total).toBe(3);
  });

  it("narrows the ranked products, the top-up and the count to any of the families", async () => {
    await product("Floral", { rank: 1, families: ["квіткові"] });
    await product("Woody", { rank: 2, families: ["деревні"] });
    await product("Fruity second", { rank: 3, families: ["свіжі", "фруктові"] });
    await product("Fruity unranked", { families: ["фруктові"] });
    await product("Citrus unranked", { families: ["цитрусові"] });

    const result = await popular(["квіткові", "фруктові"]);
    expect(result.titles).toEqual(["Floral", "Fruity second", "Fruity unranked"]);
    expect(result.total).toBe(3);
  });

  it("is empty when nothing matches", async () => {
    await product("Woody", { rank: 1, families: ["деревні"] });

    expect(await popular(["квіткові"])).toMatchObject({
      titles: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
  });

  it("narrows to a gender with unisex, like the catalogs (#102)", async () => {
    await product("Women", { rank: 1 });
    await product("Men", { rank: 2, gender: "men" });
    await product("Unisex", { rank: 3, gender: "unisex" });
    await product("Men unranked", { gender: "men" });

    expect(await popular([], 1, "women")).toMatchObject({
      titles: ["Women", "Unisex"],
      total: 2,
    });
    expect(await popular([], 1, "men")).toMatchObject({
      titles: ["Men", "Unisex", "Men unranked"],
      total: 3,
    });
  });

  it("combines the gender with the families (#102)", async () => {
    await product("Floral women", { rank: 1, families: ["квіткові"] });
    await product("Floral men", { rank: 2, gender: "men", families: ["квіткові"] });
    await product("Woody men", { rank: 3, gender: "men", families: ["деревні"] });

    expect((await popular(["квіткові"], 1, "men")).titles).toEqual(["Floral men"]);
    expect((await popular(["деревні"], 1, "women")).titles).toEqual([]);
  });
});
