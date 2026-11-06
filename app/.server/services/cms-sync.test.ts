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
  descriptionEn: "A fresh woody scent.",
  gender: "unisex",
  fragranceFamilies: ["деревні", "свіжі"],
  notes: ["лимон", "ялівець", "ладан"],
  storeCode: "7-B",
  popularRank: null,
  imageUrl: null,
  imageWidth: null,
  imageHeight: null,
  imageFormats: null,
  packSize: 1,
  active: true,
  variants: [
    { volumeMl: 50, price: "7200.00", trackStock: true, stock: 3 },
    { volumeMl: 10, price: "1900.00", trackStock: true, stock: 6 },
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
        { volumeMl: 10, price: "1900.00", trackStock: true, stock: 6 },
        { volumeMl: 50, price: "7200.00", trackStock: true, stock: 3 },
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

  it("stores, answers and clears both descriptions (#100)", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    expect(product).toMatchObject({
      description: "Свіжий деревний аромат.",
      descriptionEn: "A fresh woody scent.",
    });
    expect(await productRow(product.publicId)).toMatchObject({
      description: "Свіжий деревний аромат.",
      descriptionEn: "A fresh woody scent.",
    });

    const result = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        descriptionEn: "Citrus and juniper over incense.",
        publicId: product.publicId,
        slug: product.slug,
      },
      testDb.db,
    );
    expect(result).toMatchObject({
      ok: true,
      product: {
        description: "Свіжий деревний аромат.",
        descriptionEn: "Citrus and juniper over incense.",
      },
    });

    await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        descriptionEn: null,
        publicId: product.publicId,
        slug: product.slug,
      },
      testDb.db,
    );
    expect(await productRow(product.publicId)).toMatchObject({
      description: "Свіжий деревний аромат.",
      descriptionEn: null,
    });
  });

  it("sets, changes and clears the popular position (#67)", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    expect(product.popularRank).toBeNull();

    const update = (popularRank: number | null) =>
      applyCmsProductChange(
        {
          action: "update",
          ...fields,
          popularRank,
          publicId: product.publicId,
          slug: product.slug,
        },
        testDb.db,
      );

    expect(await update(3)).toMatchObject({ ok: true, product: { popularRank: 3 } });
    expect(await productRow(product.publicId)).toMatchObject({ popularRank: 3 });
    expect(await update(1)).toMatchObject({ ok: true, product: { popularRank: 1 } });
    expect(await productRow(product.publicId)).toMatchObject({ popularRank: 1 });
    expect(await update(null)).toMatchObject({ ok: true, product: { popularRank: null } });
    expect(await productRow(product.publicId)).toMatchObject({ popularRank: null });
  });

  it("stores the image's size and formats, and clears them with the image (#88)", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    const formats = [{ url: "http://cms.test/uploads/small_p.jpg", width: 400, height: 500 }];
    const update = (image: Partial<typeof fields>) =>
      applyCmsProductChange(
        { action: "update", ...fields, ...image, publicId: product.publicId, slug: product.slug },
        testDb.db,
      );

    await update({
      imageUrl: "http://cms.test/uploads/p.jpg",
      imageWidth: 800,
      imageHeight: 1000,
      imageFormats: formats,
    });
    expect(await productRow(product.publicId)).toMatchObject({
      imageUrl: "http://cms.test/uploads/p.jpg",
      imageWidth: 800,
      imageHeight: 1000,
      imageFormats: formats,
    });

    await update({ imageUrl: null, imageWidth: 800, imageHeight: 1000, imageFormats: formats });
    expect(await productRow(product.publicId)).toMatchObject({
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageFormats: null,
    });
  });

  it("stores families, notes and the store code and keeps fragrance_family the first family", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();

    expect(product).toMatchObject({
      fragranceFamilies: ["деревні", "свіжі"],
      notes: ["лимон", "ялівець", "ладан"],
      storeCode: "7-B",
    });
    expect(await productRow(product.publicId)).toMatchObject({
      fragranceFamily: "деревні",
      fragranceFamilies: ["деревні", "свіжі"],
      notes: ["лимон", "ялівець", "ладан"],
      storeCode: "7-B",
    });

    // Staff reorder the families: the new first one becomes the primary.
    const reordered = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        fragranceFamilies: ["свіжі", "деревні"],
        notes: [],
        storeCode: null,
        publicId: product.publicId,
        slug: product.slug,
      },
      testDb.db,
    );
    expect(reordered).toMatchObject({
      ok: true,
      product: { fragranceFamilies: ["свіжі", "деревні"], notes: [], storeCode: null },
    });
    expect(await productRow(product.publicId)).toMatchObject({
      fragranceFamily: "свіжі",
      notes: [],
      storeCode: null,
    });

    // A set may have no family: the primary is then null.
    const set = await applyCmsProductChange(
      {
        action: "update",
        ...fields,
        packSize: 3,
        fragranceFamilies: [],
        publicId: product.publicId,
        slug: product.slug,
      },
      testDb.db,
    );
    expect(set).toMatchObject({ ok: true, product: { fragranceFamilies: [] } });
    expect((await productRow(product.publicId)).fragranceFamily).toBeNull();
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
          { volumeMl: 10, price: "1950.00", trackStock: true, stock: 10, expectedStock: 6 },
          { volumeMl: 50, price: "7200.00", trackStock: true, stock: 0, expectedStock: 3 },
        ],
      },
      testDb.db,
    );

    expect(result).toMatchObject({
      ok: true,
      product: {
        variants: [
          { volumeMl: 10, price: "1950.00", trackStock: true, stock: 8 },
          { volumeMl: 50, price: "7200.00", trackStock: true, stock: 0 },
        ],
      },
    });
    expect((await variantRow(id, 10))?.id).toBe(small?.id);
  });

  it("stores the typed stock of a size that doesn't track it, and switches tracking (#98)", async () => {
    const { applyCmsProductChange } = await import("./cms-sync");
    const product = await created();
    const { id } = await productRow(product.publicId);
    const update = (variants: (typeof fields)["variants"]) =>
      applyCmsProductChange(
        { action: "update", ...fields, publicId: product.publicId, slug: product.slug, variants },
        testDb.db,
      );

    // Untracked: no delta, whatever Strapi showed before.
    const untracked = await update([
      { volumeMl: 10, price: "1900.00", trackStock: false, stock: 0, expectedStock: 6 },
      { volumeMl: 50, price: "7200.00", trackStock: false, stock: 9, expectedStock: 1 },
    ]);
    expect(untracked).toMatchObject({
      ok: true,
      product: {
        variants: [
          { volumeMl: 10, trackStock: false, stock: 0 },
          { volumeMl: 50, trackStock: false, stock: 9 },
        ],
      },
    });
    expect(await variantRow(id, 50)).toMatchObject({ trackStock: false, stockQuantity: 9 });

    // Switched on: the typed stock is the starting point.
    const tracked = await update([
      { volumeMl: 10, price: "1900.00", trackStock: false, stock: 0, expectedStock: 0 },
      { volumeMl: 50, price: "7200.00", trackStock: true, stock: 2, expectedStock: 9 },
    ]);
    expect(tracked).toMatchObject({
      ok: true,
      product: { variants: [{ volumeMl: 10 }, { volumeMl: 50, trackStock: true, stock: 2 }] },
    });

    // A new size comes with its own tracking.
    const added = await update([
      { volumeMl: 10, price: "1900.00", trackStock: false, stock: 0, expectedStock: 0 },
      { volumeMl: 50, price: "7200.00", trackStock: true, stock: 2, expectedStock: 2 },
      { volumeMl: 100, price: "9690.00", trackStock: false, stock: 0 },
    ]);
    expect(added).toMatchObject({ ok: true });
    expect(await variantRow(id, 100)).toMatchObject({ trackStock: false });
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
          { volumeMl: 10, price: "1900.00", trackStock: true, stock: 0, expectedStock: 20 },
          { volumeMl: 50, price: "7200.00", trackStock: true, stock: 3 },
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
          { volumeMl: 50, price: "7200.00", trackStock: true, stock: 3, expectedStock: 3 },
          { volumeMl: 100, price: "9900.00", trackStock: true, stock: 2 },
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

  describe("slug history (#83)", () => {
    async function history() {
      const { productSlugHistory } = await import("../db/schema");
      const rows = await testDb.db
        .select({ slug: productSlugHistory.slug, productId: productSlugHistory.productId })
        .from(productSlugHistory);
      return rows.sort((a, b) => a.slug.localeCompare(b.slug));
    }

    async function rename(publicId: string, slug: string) {
      const { applyCmsProductChange } = await import("./cms-sync");
      return applyCmsProductChange({ action: "update", ...fields, publicId, slug }, testDb.db);
    }

    beforeEach(async () => {
      const { productSlugHistory } = await import("../db/schema");
      await testDb.db.delete(productSlugHistory);
    });

    it("keeps the old slug when staff rename one, and nothing when the slug stays", async () => {
      const product = await created();
      const { id } = await productRow(product.publicId);

      expect(await rename(product.publicId, product.slug)).toMatchObject({ ok: true });
      expect(await history()).toEqual([]);

      expect(await rename(product.publicId, `${product.slug}-new`)).toMatchObject({
        ok: true,
        product: { slug: `${product.slug}-new` },
      });
      expect(await history()).toEqual([{ slug: product.slug, productId: id }]);
    });

    it("forgets an old slug once a product takes it again", async () => {
      const product = await created();
      const { id } = await productRow(product.publicId);
      await rename(product.publicId, `${product.slug}-new`);

      await rename(product.publicId, product.slug);

      expect(await history()).toEqual([{ slug: `${product.slug}-new`, productId: id }]);
    });

    it("forgets an old slug that another product takes or a new product gets", async () => {
      const { applyCmsProductChange } = await import("./cms-sync");
      const first = await created();
      await rename(first.publicId, `${first.slug}-renamed`);
      const second = await created();

      expect(await rename(second.publicId, first.slug)).toMatchObject({ ok: true });
      expect((await history()).map((row) => row.slug)).toEqual([second.slug]);

      // A new product can take an old slug too.
      await applyCmsProductChange({ action: "create", ...fields, slug: second.slug }, testDb.db);
      expect(await history()).toEqual([]);
    });

    it("writes nothing for a taken slug or an archive", async () => {
      const { applyCmsProductChange } = await import("./cms-sync");
      const first = await created();
      const second = await created();

      expect(await rename(second.publicId, first.slug)).toMatchObject({ error: "slug-taken" });
      await applyCmsProductChange({ action: "delete", publicId: second.publicId }, testDb.db);

      expect(await history()).toEqual([]);
      expect((await productRow(second.publicId)).slug).toBe(second.slug);
    });
  });

  /**
   * A product whose 10 ml size has 6 in stock (tracked unless `trackStock` is false, #98), and an
   * order for `quantity` of it.
   */
  async function placed({
    trackStock = true,
    ...options
  }: {
    quantity?: number;
    paymentMethod?: "cod" | "card";
    trackStock?: boolean;
  } = {}) {
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("../db/schema");
    const product = await created();
    const { id } = await productRow(product.publicId);
    const small = await variantRow(id, 10);
    await testDb.db
      .update(productVariants)
      .set({ trackStock })
      .where(eq(productVariants.id, small?.id ?? 0));
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

  it("cancels an order without changing the stock of a size that doesn't track it (#98)", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { cmsOutbox } = await import("../db/schema");
    await testDb.db.delete(cmsOutbox);
    const { productId, orderId } = await placed({ quantity: 2, trackStock: false });

    const result = await applyCmsOrderChange(
      orderId,
      { status: "cancelled", cancelReason: "customer_request" },
      testDb.db,
    );

    expect(result).toMatchObject({
      ok: true,
      order: { status: "cancelled", cancelReason: "customer_request" },
    });
    expect((await variantRow(productId, 10))?.stockQuantity).toBe(6);
    expect((await outbox()).filter((row) => row.entity === "product")).toEqual([]);
  });

  it("cancels an order and puts its units back in stock exactly once", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { cmsOutbox } = await import("../db/schema");
    await testDb.db.delete(cmsOutbox);
    const { productId, orderId } = await placed({ quantity: 2 });

    const result = await applyCmsOrderChange(
      orderId,
      { status: "cancelled", cancelReason: "customer_request" },
      testDb.db,
    );
    expect(result).toMatchObject({
      ok: true,
      order: { status: "cancelled", cancelReason: "customer_request" },
    });
    expect((await variantRow(productId, 10))?.stockQuantity).toBe(8);
    expect(await outbox()).toEqual([{ entity: "product", entityId: productId }]);

    // A repeat of the same change is no change; leaving `cancelled` is refused.
    expect(
      await applyCmsOrderChange(
        orderId,
        { status: "cancelled", cancelReason: "customer_request" },
        testDb.db,
      ),
    ).toMatchObject({
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

  it("gives a gift card's amount back when the order is cancelled, not when it's returned (#125)", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { findGiftCard, redeemGiftCard } = await import("../db/queries/gift-cards");
    const { cmsOutbox, giftCards } = await import("../db/schema");
    const card = async (code: string) => {
      const [row] = await testDb.db
        .insert(giftCards)
        .values({
          code,
          initialAmount: "500.00",
          balance: "500.00",
          status: "active",
          buyerEmail: "buyer@example.com",
          locale: "uk",
          activatedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: giftCards.id });
      return row?.id ?? 0;
    };
    await testDb.db.delete(cmsOutbox);
    const cancelled = await placed();
    const cancelledCard = await card("RESTORE000000001");
    await redeemGiftCard(testDb.db, {
      giftCardId: cancelledCard,
      orderId: cancelled.orderId,
      amount: "500.00",
    });
    expect((await findGiftCard(testDb.db, cancelledCard))?.status).toBe("used_up");

    await applyCmsOrderChange(
      cancelled.orderId,
      { status: "cancelled", cancelReason: "customer_request" },
      testDb.db,
    );
    expect(await findGiftCard(testDb.db, cancelledCard)).toMatchObject({
      balance: "500.00",
      status: "active",
    });
    expect(await outbox()).toContainEqual({ entity: "gift_card", entityId: cancelledCard });

    // A returned order keeps what the card paid, like its stock.
    const returned = await placed();
    const returnedCard = await card("RESTORE000000002");
    await redeemGiftCard(testDb.db, {
      giftCardId: returnedCard,
      orderId: returned.orderId,
      amount: "200.00",
    });
    for (const status of ["shipped", "completed", "returned"] as const) {
      await applyCmsOrderChange(returned.orderId, { status }, testDb.db);
    }
    expect((await findGiftCard(testDb.db, returnedCard))?.balance).toBe("300.00");
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
      { status: "cancelled", paymentStatus: "refunded", cancelReason: "out_of_stock" },
      testDb.db,
    );
    expect(refunded).toMatchObject({
      ok: true,
      order: { status: "cancelled", paymentStatus: "refunded", cancelReason: "out_of_stock" },
    });
    if (!refunded.ok) throw new Error("expected a refund");
    expect(refunded.order.paidAt).not.toBeNull();
    expect(refunded.order.refundedAt).not.toBeNull();
    expect(refunded.order.cancelledAt).not.toBeNull();
  });

  it("records each status change in the history and nothing for a refusal (#128)", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { listOrderStatusHistory } = await import("../db/queries/order-status-history");
    const { orderId } = await placed({ paymentMethod: "card" });
    const at = (hour: number) => new Date(`2026-10-25T${String(hour).padStart(2, "0")}:00:00Z`);
    const history = async () =>
      (await listOrderStatusHistory(testDb.db, orderId)).map((row) => [
        row.status,
        row.source,
        row.changedAt,
      ]);

    // A card order can't ship unpaid: refused, nothing recorded.
    expect(
      await applyCmsOrderChange(orderId, { status: "shipped" }, testDb.db, at(9)),
    ).toMatchObject({ ok: false, error: "card-not-paid" });
    // Marking the payment paid moves the order to `paid`: that's a status change too.
    await applyCmsOrderChange(orderId, { paymentStatus: "paid" }, testDb.db, at(10));
    await applyCmsOrderChange(orderId, { status: "shipped" }, testDb.db, at(11));
    const unclaimed = await applyCmsOrderChange(
      orderId,
      { status: "unclaimed" },
      testDb.db,
      at(12),
    );
    // The same status again is no change and records nothing.
    await applyCmsOrderChange(orderId, { status: "unclaimed" }, testDb.db, at(13));

    expect(unclaimed).toMatchObject({
      ok: true,
      order: { status: "unclaimed", returnedAt: at(12).toISOString(), cancelReason: null },
    });
    expect(await history()).toEqual([
      ["paid", "cms", at(10)],
      ["shipped", "cms", at(11)],
      ["unclaimed", "cms", at(12)],
    ]);
  });

  it("refuses to cancel without a reason and stores the reason given (#128)", async () => {
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("../db/schema");
    const { applyCmsOrderChange } = await import("./cms-sync");
    const { listOrderStatusHistory } = await import("../db/queries/order-status-history");
    const { productId, orderId } = await placed({ quantity: 2 });

    expect(await applyCmsOrderChange(orderId, { status: "cancelled" }, testDb.db)).toEqual({
      ok: false,
      error: "cancel-reason-required",
      from: "pending",
      to: "cancelled",
    });
    const [before] = await testDb.db.select().from(orders).where(eq(orders.id, orderId));
    expect(before).toMatchObject({ status: "pending", cancelledAt: null, cancelReason: null });
    expect((await variantRow(productId, 10))?.stockQuantity).toBe(6);
    expect(await listOrderStatusHistory(testDb.db, orderId)).toEqual([]);

    const result = await applyCmsOrderChange(
      orderId,
      { status: "cancelled", cancelReason: "no_answer" },
      testDb.db,
    );
    expect(result).toMatchObject({
      ok: true,
      order: { status: "cancelled", cancelReason: "no_answer" },
    });
    expect(await listOrderStatusHistory(testDb.db, orderId)).toEqual([
      expect.objectContaining({ status: "cancelled", source: "cms" }),
    ]);
  });

  it("answers unknown-order for a missing order", async () => {
    const { applyCmsOrderChange } = await import("./cms-sync");

    expect(await applyCmsOrderChange(2_000_000, { status: "shipped" }, testDb.db)).toEqual({
      ok: false,
      error: "unknown-order",
    });
  });
});
