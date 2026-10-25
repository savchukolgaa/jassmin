import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsProductFields } from "~/lib/cms-sync";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

beforeAll(() => {
  // `../db` validates the env on import.
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const fields: CmsProductFields = {
  name: "Gypsy Water",
  slug: "gypsy-water",
  brand: "Byredo",
  description: "Свіжий деревний аромат.",
  gender: "unisex",
  fragranceFamily: "деревні",
  imageUrl: null,
  packSize: 1,
  active: true,
  variants: [
    { volumeMl: 50, price: "7200.00", stock: 3 },
    { volumeMl: 10, price: "1900.00", stock: 6 },
  ],
};

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cms product sync", () => {
  let testDb: TestDatabase;
  let slugCounter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_cms_sync_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { carts, orders } = await import("../db/schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(carts);
  });

  /** A new product with the sample sizes, under a fresh slug. */
  async function created() {
    const { applyCmsProductChange } = await import("./cms-sync");
    slugCounter += 1;
    const result = await applyCmsProductChange(
      { action: "create", ...fields, slug: `gypsy-water-${slugCounter}` },
      testDb.db,
    );
    if (!result.ok) throw new Error(result.error);
    return { ...result.product, slug: result.product.slug ?? "" };
  }

  async function productRow(publicId: string) {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const [row] = await testDb.db.select().from(products).where(eq(products.publicId, publicId));
    if (!row) throw new Error("no product");
    return row;
  }

  async function variantRow(productId: number, volumeMl: number) {
    const { and, eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.volumeMl, volumeMl)));
    return row;
  }

  /** An order with one line of this size, as checkout would leave it. */
  async function orderWith(
    productId: number,
    variantId: number,
    {
      quantity = 1,
      paymentMethod = "cod",
    }: { quantity?: number; paymentMethod?: "cod" | "card" } = {},
  ) {
    const { orderItems, orders } = await import("../db/schema");
    const [order] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "A",
        guestEmail: "a@example.com",
        guestPhone: "+380",
        shippingAddress: "Kyiv",
        paymentMethod,
        subtotal: "1900.00",
        totalAmount: "1900.00",
      })
      .returning();
    await testDb.db.insert(orderItems).values({
      orderId: order?.id ?? 0,
      productId,
      variantId,
      volumeMl: 10,
      quantity,
      priceAtPurchase: "1900.00",
    });
    return order?.id ?? 0;
  }

  it("creates the product with its sizes and fills the deprecated columns from the smallest", async () => {
    const product = await created();

    expect(product).toMatchObject({
      name: "Gypsy Water",
      brand: "Byredo",
      active: true,
      variants: [
        { volumeMl: 10, price: "1900.00", stock: 6 },
        { volumeMl: 50, price: "7200.00", stock: 3 },
      ],
    });
    expect(product.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await productRow(product.publicId)).toMatchObject({
      title: "Gypsy Water",
      price: "1900.00",
      volumeMl: 10,
      stockQuantity: 6,
    });
  });

  it("applies a stock edit as a difference, so sales made meanwhile stay sold", async () => {
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    const { id } = await productRow(product.publicId);
    const small = await variantRow(id, 10);
    // Staff saw 6 and restock to 10 (+4), but checkout sold 2 since.
    await testDb.db
      .update(productVariants)
      .set({ stockQuantity: 4 })
      .where(eq(productVariants.id, small?.id ?? 0));

    const result = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        publicId: product.publicId,
        slug: product.slug,
        variants: [
          { volumeMl: 10, price: "1950.00", stock: 10, expectedStock: 6 },
          { volumeMl: 50, price: "7200.00", stock: 0, expectedStock: 3 },
        ],
      },
      testDb.db,
    );

    expect(result).toMatchObject({
      ok: true,
      product: {
        variants: [
          { volumeMl: 10, price: "1950.00", stock: 8 },
          { volumeMl: 50, price: "7200.00", stock: 0 },
        ],
      },
    });
    expect((await variantRow(id, 10))?.id).toBe(small?.id);
  });

  it("never takes stock below zero", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();

    const result = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        publicId: product.publicId,
        slug: product.slug,
        variants: [
          { volumeMl: 10, price: "1900.00", stock: 0, expectedStock: 20 },
          { volumeMl: 50, price: "7200.00", stock: 3 },
        ],
      },
      testDb.db,
    );

    expect(result).toMatchObject({
      ok: true,
      product: { variants: [{ stock: 0 }, { stock: 3 }] },
    });
  });

  it("adds and removes sizes; a removed size drops its cart lines and keeps its order lines", async () => {
    const { eq } = await import("drizzle-orm");
    const { cartItems, carts, orderItems } = await import("../db/schema");
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    const { id } = await productRow(product.publicId);
    const small = await variantRow(id, 10);
    const [cart] = await testDb.db.insert(carts).values({}).returning();
    await testDb.db
      .insert(cartItems)
      .values({ cartId: cart?.id ?? 0, productId: id, variantId: small?.id ?? 0, quantity: 1 });
    const orderId = await orderWith(id, small?.id ?? 0);

    const result = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        publicId: product.publicId,
        slug: product.slug,
        variants: [
          { volumeMl: 50, price: "7200.00", stock: 3, expectedStock: 3 },
          { volumeMl: 100, price: "9900.00", stock: 2 },
        ],
      },
      testDb.db,
    );

    expect(result).toMatchObject({
      ok: true,
      product: { variants: [{ volumeMl: 50 }, { volumeMl: 100, stock: 2 }] },
    });
    expect(await variantRow(id, 10)).toBeUndefined();
    expect(
      await testDb.db
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, cart?.id ?? 0)),
    ).toEqual([]);
    const [line] = await testDb.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(line).toMatchObject({ productId: id, variantId: null, volumeMl: 10 });
    // The deprecated columns follow the new smallest size.
    expect(await productRow(product.publicId)).toMatchObject({ volumeMl: 50, price: "7200.00" });
  });

  it("archives a deleted product and keeps it for order history", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const { listOrderLines } = await import("../db/queries/orders");
    const product = await created();
    const { id } = await productRow(product.publicId);
    const orderId = await orderWith(id, (await variantRow(id, 10))?.id ?? 0);

    const result = await applyCmsProductChange(
      { action: "delete", publicId: product.publicId },
      testDb.db,
    );

    expect(result).toMatchObject({ ok: true, product: { active: false } });
    expect((await productRow(product.publicId)).active).toBe(false);
    expect(await listOrderLines(testDb.db, orderId)).toMatchObject([
      { title: "Gypsy Water", brand: "Byredo", volumeMl: 10 },
    ]);
  });

  it("refuses a taken slug and an unknown product", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();

    expect(
      await applyCmsProductChange({ action: "create", ...fields, slug: product.slug }, testDb.db),
    ).toEqual({ ok: false, error: "slug-taken", slug: product.slug });
    expect(
      await applyCmsProductChange(
        { action: "delete", publicId: "01a1652b-6e25-7fff-8000-000000000000" },
        testDb.db,
      ),
    ).toEqual({ ok: false, error: "unknown-product" });
  });

  /** A product whose 10 ml size has 6 in stock, and an order for `quantity` of it. */
  async function placed(options: { quantity?: number; paymentMethod?: "cod" | "card" } = {}) {
    const product = await created();
    const { id } = await productRow(product.publicId);
    const small = await variantRow(id, 10);
    const orderId = await orderWith(id, small?.id ?? 0, options);
    return { productId: id, variantId: small?.id ?? 0, orderId };
  }

  async function outbox() {
    const { cmsOutbox } = await import("../db/schema");
    return testDb.db
      .select({ entity: cmsOutbox.entity, entityId: cmsOutbox.entityId })
      .from(cmsOutbox);
  }

  it("ships a cash-on-delivery order unpaid and returns it for Strapi", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { orderId } = await placed();
    const now = new Date("2026-10-25T10:00:00Z");

    const result = await applyCmsOrderChange(orderId, { status: "shipped" }, testDb.db, now);

    expect(result).toMatchObject({
      ok: true,
      order: {
        orderId,
        status: "shipped",
        paymentStatus: "unpaid",
        shippedAt: now.toISOString(),
        items: [{ productName: "Gypsy Water", volumeMl: 10, quantity: 1, unitPrice: "1900.00" }],
      },
    });
  });

  it("cancels an order and puts its units back in stock exactly once", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { cmsOutbox } = await import("../db/schema");
    await testDb.db.delete(cmsOutbox);
    const { productId, orderId } = await placed({ quantity: 2 });

    const result = await applyCmsOrderChange(orderId, { status: "cancelled" }, testDb.db);
    expect(result).toMatchObject({ ok: true, order: { status: "cancelled" } });
    expect((await variantRow(productId, 10))?.stockQuantity).toBe(8);
    expect(await outbox()).toEqual([{ entity: "product", entityId: productId }]);

    // A repeat of the same change is no change; leaving `cancelled` is refused.
    expect(await applyCmsOrderChange(orderId, { status: "cancelled" }, testDb.db)).toMatchObject({
      ok: true,
    });
    expect(await applyCmsOrderChange(orderId, { status: "shipped" }, testDb.db)).toEqual({
      ok: false,
      error: "invalid-transition",
      from: "cancelled",
      to: "shipped",
    });
    expect((await variantRow(productId, 10))?.stockQuantity).toBe(8);
  });

  it("writes nothing for a refused change", async () => {
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("../db/schema");
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { orderId } = await placed({ paymentMethod: "card" });

    expect(await applyCmsOrderChange(orderId, { status: "shipped" }, testDb.db)).toEqual({
      ok: false,
      error: "card-not-paid",
      from: "pending",
      to: "shipped",
    });
    const [row] = await testDb.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "pending", shippedAt: null });
  });

  it("refunds a paid order and sets the timestamps", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { orderId } = await placed({ paymentMethod: "card" });

    const paid = await applyCmsOrderChange(orderId, { paymentStatus: "paid" }, testDb.db);
    expect(paid).toMatchObject({ ok: true, order: { status: "paid", paymentStatus: "paid" } });
    const refunded = await applyCmsOrderChange(
      orderId,
      { status: "cancelled", paymentStatus: "refunded" },
      testDb.db,
    );
    expect(refunded).toMatchObject({
      ok: true,
      order: { status: "cancelled", paymentStatus: "refunded" },
    });
    if (!refunded.ok) throw new Error("expected a refund");
    expect(refunded.order.paidAt).not.toBeNull();
    expect(refunded.order.refundedAt).not.toBeNull();
    expect(refunded.order.cancelledAt).not.toBeNull();
  });

  it("answers unknown-order for a missing order", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");

    expect(await applyCmsOrderChange(2_000_000, { status: "shipped" }, testDb.db)).toEqual({
      ok: false,
      error: "unknown-order",
    });
  });
});
