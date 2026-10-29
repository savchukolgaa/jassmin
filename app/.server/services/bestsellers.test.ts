import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus } from "~/lib/enums";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("home page bestsellers and trio families", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_bestsellers_test");
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

  /** An order in `status` with `quantity` units of each product. */
  async function order(status: OrderStatus, lines: [productId: number, quantity: number][]) {
    const { orderItems, orders } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "Olha",
        guestEmail: "olha@example.com",
        guestPhone: "+380501234567",
        shippingAddress: "Kyiv",
        paymentMethod: "cod",
        status,
        subtotal: "100.00",
        totalAmount: "100.00",
      })
      .returning({ id: orders.id });
    if (!row) throw new Error("no order");
    await testDb.db.insert(orderItems).values(
      lines.map(([productId, quantity]) => ({
        orderId: row.id,
        productId,
        quantity,
        priceAtPurchase: "100.00",
      })),
    );
  }

  const bestsellerTitles = async () => {
    const { getBestsellers } = await import("./products");
    return (await getBestsellers(testDb.db)).map((p) => p.title);
  };

  it("ranks by units sold in paid, shipped and completed orders", async () => {
    const a = await product("A", { minutesAgo: 50 });
    const b = await product("B", { minutesAgo: 40 });
    const c = await product("C", { minutesAgo: 30 });
    const d = await product("D", { minutesAgo: 20 });
    await product("E", { minutesAgo: 10 });
    await order("paid", [[a, 1]]);
    await order("shipped", [[b, 2]]);
    await order("completed", [
      [c, 3],
      [d, 1],
    ]);
    await order("completed", [[d, 3]]);

    expect(await bestsellerTitles()).toEqual(["D", "C", "B", "A"]);
  });

  it("ignores pending, cancelled, returned and unclaimed orders", async () => {
    const old = await product("Old", { minutesAgo: 60 });
    const sold = await product("Sold", { minutesAgo: 50 });
    await product("New", { minutesAgo: 1 });
    await order("completed", [[sold, 1]]);
    for (const status of ["pending", "cancelled", "returned", "unclaimed"] as const) {
      await order(status, [[old, 10]]);
    }

    expect(await bestsellerTitles()).toEqual(["Sold", "New", "Old"]);
  });

  it("tops up with the newest products and skips unlisted ones", async () => {
    const archived = await product("Archived", { active: false });
    const unsold = await product("No sizes", { variants: false });
    await product("Older", { minutesAgo: 30 });
    await product("Newer", { minutesAgo: 5 });
    const top = await product("Top", { minutesAgo: 90 });
    await order("completed", [
      [archived, 9],
      [unsold, 9],
      [top, 1],
    ]);

    expect(await bestsellerTitles()).toEqual(["Top", "Newer", "Older"]);
  });

  it("carries each product's sizes for the card's volume picker (#74)", async () => {
    await product("A");
    const { getBestsellers } = await import("./products");
    const [first] = await getBestsellers(testDb.db);

    expect(first?.variants).toEqual([
      { id: first?.defaultVariant.id, volumeMl: 30, price: "100.00", inStock: true },
    ]);
  });

  it("shows four products at most", async () => {
    for (const title of ["1", "2", "3", "4", "5"]) {
      await product(title);
    }

    expect(await bestsellerTitles()).toHaveLength(4);
  });

  it("offers every family of listed products of every gender", async () => {
    const { getTrioFamilies } = await import("./products");
    await product("Floral", { families: ["квіткові", "свіжі"], gender: "women" });
    await product("Woody", { families: ["деревні"], gender: "men" });
    await product("Fresh", { families: ["свіжі"], gender: "unisex" });
    await product("Spicy", { families: ["квіткові", "пряні"], gender: "men" });
    await product("Archived", { families: ["архівні"], active: false });
    await product("No sizes", { families: ["без розмірів"], variants: false });
    await product("Plain");

    // Secondary families count too (#65).
    expect(await getTrioFamilies(testDb.db)).toEqual(["деревні", "квіткові", "пряні", "свіжі"]);
  });
});
