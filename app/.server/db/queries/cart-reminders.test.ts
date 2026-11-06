import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

const sampleOrder = {
  guestFullName: "Test Buyer",
  guestEmail: "buyer@example.com",
  guestPhone: "+380501234567",
  shippingAddress: "Kyiv, Nova Poshta branch 1",
  paymentMethod: "cod",
  subtotal: "100.00",
  totalAmount: "100.00",
} as const;

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cart reminder queries", () => {
  let testDb: TestDatabase;
  /** Variants of three different products, all in stock (tracked). */
  let variants: { id: number; productId: number }[] = [];
  let emailCounter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    const { seedProducts } = await import("../seed");
    const { productVariants } = await import("../schema");
    testDb = await createTestDatabase("jassmin_cart_reminders_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    const rows = await testDb.db.select().from(productVariants);
    const byProduct = new Map<number, { id: number; productId: number }>();
    for (const row of rows) {
      if (!byProduct.has(row.productId)) byProduct.set(row.productId, row);
    }
    variants = [...byProduct.values()].slice(0, 5);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await testDb.db.execute(
      sql`truncate order_emails, orders, cart_items, carts, email_suppressions, users restart identity cascade`,
    );
    await testDb.db.execute(
      sql`update product_variants set track_stock = true, stock_quantity = 10`,
    );
    await testDb.db.execute(sql`update products set active = true`);
  });

  async function user({
    optIn = true,
    locale = null,
  }: {
    optIn?: boolean;
    locale?: "uk" | "en" | null;
  } = {}) {
    const { users } = await import("../schema");
    emailCounter += 1;
    const [row] = await testDb.db
      .insert(users)
      .values({
        fullName: "Olena",
        email: `Shopper${emailCounter}@Example.com`,
        passwordHash: "x",
        marketingOptIn: optIn,
        locale,
      })
      .returning();
    if (!row) throw new Error("no user");
    return row;
  }

  /**
   * A cart of `userId` with one line per variant index, abandoned `hoursAgo` hours ago and last
   * active an hour before that.
   */
  async function abandoned(
    userId: number | null,
    {
      hoursAgo = 2,
      lines = [0],
      status = "abandoned",
    }: { hoursAgo?: number; lines?: number[]; status?: "abandoned" | "active" } = {},
  ) {
    const { sql } = await import("drizzle-orm");
    const { cartItems, carts } = await import("../schema");
    const [cart] = await testDb.db.insert(carts).values({ userId, status }).returning();
    const id = cart?.id ?? 0;
    for (const [n, index] of lines.entries()) {
      const variant = variants[index];
      if (!variant) throw new Error("no variant");
      await testDb.db.insert(cartItems).values({
        cartId: id,
        productId: variant.productId,
        variantId: variant.id,
        quantity: n + 1,
      });
    }
    await testDb.db.execute(sql`
      update carts set
        updated_at = now() - make_interval(hours => ${hoursAgo + 1}),
        abandoned_at = case when status = 'abandoned'
          then now() - make_interval(hours => ${hoursAgo}) end
      where id = ${id}`);
    return id;
  }

  async function queue() {
    const { queueCartReminders } = await import("./cart-reminders");
    return queueCartReminders(testDb.db);
  }

  async function cartRow(id: number) {
    const { eq } = await import("drizzle-orm");
    const { carts } = await import("../schema");
    const [row] = await testDb.db.select().from(carts).where(eq(carts.id, id));
    return row;
  }

  it("queues one reminder for an opted-in user's abandoned cart, keeping updated_at", async () => {
    const { findCartReminderEmail } = await import("./cart-reminders");
    const shopper = await user({ locale: "en" });
    const cartId = await abandoned(shopper.id);
    const before = await cartRow(cartId);

    expect(await queue()).toEqual([cartId]);

    const after = await cartRow(cartId);
    expect(after?.reminderSentAt).toBeInstanceOf(Date);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.status).toBe("abandoned");
    expect(await findCartReminderEmail(testDb.db, cartId)).toMatchObject({
      locale: "en",
      status: "pending",
    });
    // A second run queues nothing.
    expect(await queue()).toEqual([]);
  });

  it("skips users without consent, guests and suppressed addresses", async () => {
    const { emailSuppressions } = await import("../schema");
    const noConsent = await user({ optIn: false });
    await abandoned(noConsent.id);
    await abandoned(null);
    const suppressed = await user();
    await testDb.db
      .insert(emailSuppressions)
      .values({ address: suppressed.email.toLowerCase(), reason: "hard_bounce" });
    await abandoned(suppressed.id);

    expect(await queue()).toEqual([]);
  });

  it("skips carts abandoned more than 72 hours ago and active carts", async () => {
    const shopper = await user();
    await abandoned(shopper.id, { hoursAgo: 73 });
    const other = await user();
    await abandoned(other.id, { status: "active" });

    expect(await queue()).toEqual([]);
  });

  it("skips users reminded in the last 7 days", async () => {
    const { sql } = await import("drizzle-orm");
    const shopper = await user();
    const first = await abandoned(shopper.id, { hoursAgo: 60 });
    await testDb.db.execute(
      sql`update carts set reminder_sent_at = now() - interval '6 days' where id = ${first}`,
    );
    await abandoned(shopper.id);
    expect(await queue()).toEqual([]);

    await testDb.db.execute(
      sql`update carts set reminder_sent_at = now() - interval '8 days' where id = ${first}`,
    );
    expect(await queue()).toHaveLength(1);
  });

  it("skips users who ordered since the cart's last activity", async () => {
    const { orders } = await import("../schema");
    const shopper = await user();
    await abandoned(shopper.id);
    await testDb.db.insert(orders).values({ ...sampleOrder, userId: shopper.id });

    expect(await queue()).toEqual([]);
  });

  it("skips users shopping in a newer active cart", async () => {
    const shopper = await user();
    await abandoned(shopper.id, { hoursAgo: 5 });
    await abandoned(shopper.id, { status: "active", hoursAgo: 0 });

    expect(await queue()).toEqual([]);
  });

  it("skips carts with nothing left to buy", async () => {
    const { sql } = await import("drizzle-orm");
    const shopper = await user();
    await abandoned(shopper.id, { lines: [0, 1] });
    const [first, second] = variants;
    // One size sold out, the other's product archived.
    await testDb.db.execute(
      sql`update product_variants set stock_quantity = 0 where id = ${first?.id}`,
    );
    await testDb.db.execute(
      sql`update products set active = false where id = ${second?.productId}`,
    );
    expect(await queue()).toEqual([]);

    // An untracked size is always available (#98).
    await testDb.db.execute(
      sql`update product_variants set track_stock = false where id = ${first?.id}`,
    );
    expect(await queue()).toHaveLength(1);
  });

  it("reminds only about the user's latest abandoned cart", async () => {
    const shopper = await user();
    await abandoned(shopper.id, { hoursAgo: 30 });
    const latest = await abandoned(shopper.id, { hoursAgo: 3 });

    expect(await queue()).toEqual([latest]);
  });

  it("takes the language from the user, else the latest order email, else Ukrainian", async () => {
    const { findCartReminderEmail } = await import("./cart-reminders");
    const { insertOrderEmail } = await import("./order-emails");
    const { orders } = await import("../schema");
    const withOrder = await user();
    const [order] = await testDb.db
      .insert(orders)
      .values({ ...sampleOrder, userId: withOrder.id, createdAt: new Date(Date.now() - 864e5 * 3) })
      .returning();
    await insertOrderEmail(testDb.db, {
      orderId: order?.id ?? 0,
      type: "confirmation",
      locale: "en",
    });
    const fromOrder = await abandoned(withOrder.id);
    const plain = await user();
    const fallback = await abandoned(plain.id);

    await queue();

    expect((await findCartReminderEmail(testDb.db, fromOrder))?.locale).toBe("en");
    expect((await findCartReminderEmail(testDb.db, fallback))?.locale).toBe("uk");
  });

  it("loads what the email shows: up to 3 available lines and their total", async () => {
    const { sql } = await import("drizzle-orm");
    const { findCartReminder } = await import("./cart-reminders");
    const shopper = await user();
    const cartId = await abandoned(shopper.id, { lines: [0, 1, 2, 3, 4] });
    const sold = variants[4];
    await testDb.db.execute(
      sql`update product_variants set stock_quantity = 0 where id = ${sold?.id}`,
    );
    await testDb.db.execute(sql`update product_variants set price = 100.50`);

    const reminder = await findCartReminder(testDb.db, cartId);

    expect(reminder).toMatchObject({
      cartId,
      userId: shopper.id,
      email: shopper.email,
      marketingOptIn: true,
      suppressed: false,
      orderedSince: false,
      availableLineCount: 4,
      // 100.50 × (1 + 2 + 3 + 4)
      subtotal: "1005.00",
    });
    expect(reminder?.lines.map((line) => line.quantity)).toEqual([1, 2, 3]);
    expect(
      await findCartReminder(testDb.db, await abandoned(shopper.id, { status: "active" })),
    ).toBe(undefined);
  });

  it("finds a reminded cart to restore until it is restored or followed by an order", async () => {
    const { sql } = await import("drizzle-orm");
    const { findRestorableCart, markCartRestored } = await import("./cart-reminders");
    const { orders } = await import("../schema");
    const shopper = await user();
    const cartId = await abandoned(shopper.id, { lines: [0, 1] });
    expect(await findRestorableCart(testDb.db, shopper.id)).toBeUndefined();

    await queue();
    expect(await findRestorableCart(testDb.db, shopper.id)).toMatchObject({ cartId, itemCount: 3 });

    const before = await cartRow(cartId);
    expect(await markCartRestored(testDb.db, cartId)).toBe(true);
    expect(await markCartRestored(testDb.db, cartId)).toBe(false);
    expect((await cartRow(cartId))?.updatedAt).toEqual(before?.updatedAt);
    expect(await findRestorableCart(testDb.db, shopper.id)).toBeUndefined();

    await testDb.db.execute(sql`update carts set restored_at = null where id = ${cartId}`);
    await testDb.db.insert(orders).values({ ...sampleOrder, userId: shopper.id });
    expect(await findRestorableCart(testDb.db, shopper.id)).toBeUndefined();
  });
});
