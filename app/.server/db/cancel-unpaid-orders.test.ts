import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UNPAID_ORDER_HOURS, parseUnpaidOrderHours } from "./cancel-unpaid-orders";
import { hasDatabase, type TestDatabase } from "./test-utils";

describe("parseUnpaidOrderHours", () => {
  it("defaults to 48 hours when unset or empty", () => {
    expect(DEFAULT_UNPAID_ORDER_HOURS).toBe(48);
    expect(parseUnpaidOrderHours({})).toEqual({ ok: true, hours: 48 });
    expect(parseUnpaidOrderHours({ UNPAID_ORDER_HOURS: "" })).toEqual({ ok: true, hours: 48 });
  });

  it("accepts a positive whole number and rejects anything else", () => {
    expect(parseUnpaidOrderHours({ UNPAID_ORDER_HOURS: "6" })).toEqual({ ok: true, hours: 6 });
    for (const value of ["0", "-1", "1.5", "abc"]) {
      expect(parseUnpaidOrderHours({ UNPAID_ORDER_HOURS: value })).toEqual({
        ok: false,
        error: `UNPAID_ORDER_HOURS must be a positive whole number of hours, got "${value}".`,
      });
    }
  });
});

const NOW = new Date("2026-11-06T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cancelUnpaidOrders", () => {
  let testDb: TestDatabase;
  let variantId = 0;
  let productId = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    const { seedProducts } = await import("./seed");
    const { productVariants } = await import("./schema");
    testDb = await createTestDatabase("jassmin_unpaid_orders_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    const [variant] = await testDb.db.select().from(productVariants).limit(1);
    variantId = variant?.id ?? 0;
    productId = variant?.productId ?? 0;
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { eq } = await import("drizzle-orm");
    const { cmsOutbox, giftCards, orders, productVariants } = await import("./schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(giftCards);
    await testDb.db.delete(cmsOutbox);
    await testDb.db
      .update(productVariants)
      .set({ stockQuantity: 5, trackStock: true })
      .where(eq(productVariants.id, variantId));
  });

  type OrderValues = typeof import("./schema").orders.$inferInsert;

  /** An order placed `placedHoursAgo` hours ago with two units of the seeded size. */
  async function placed(placedHoursAgo: number, values: Partial<OrderValues> = {}) {
    const { orderItems, orders } = await import("./schema");
    const [order] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "A",
        guestEmail: "a@example.com",
        guestPhone: "+380671234567",
        shippingAddress: "Київ, Відділення №1",
        paymentMethod: "card",
        subtotal: "1000.00",
        totalAmount: "1000.00",
        createdAt: hoursAgo(placedHoursAgo),
        ...values,
      })
      .returning({ id: orders.id });
    const orderId = order?.id ?? 0;
    await testDb.db
      .insert(orderItems)
      .values({ orderId, productId, variantId, quantity: 2, priceAtPurchase: "500.00" });
    return orderId;
  }

  async function attempt(orderId: number, startedHoursAgo: number, attemptNo = 1) {
    const { payments } = await import("./schema");
    await testDb.db.insert(payments).values({
      orderId,
      provider: "simulator",
      reference: `${orderId}-${attemptNo}`,
      amount: "1000.00",
      createdAt: hoursAgo(startedHoursAgo),
    });
  }

  async function orderRow(orderId: number) {
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("./schema");
    const [row] = await testDb.db.select().from(orders).where(eq(orders.id, orderId));
    return row;
  }

  async function stock() {
    const { eq } = await import("drizzle-orm");
    const { productVariants } = await import("./schema");
    const [row] = await testDb.db
      .select({ stock: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    return row?.stock;
  }

  it("cancels a stale unpaid card order with payment_failed, restocks it and records the job", async () => {
    const { cancelUnpaidOrders } = await import("./cancel-unpaid-orders");
    const { listOrderStatusHistory } = await import("./queries/order-status-history");
    const { cmsOutbox } = await import("./schema");
    const stale = await placed(49);
    await attempt(stale, 48);

    const result = await cancelUnpaidOrders(testDb.db, { hours: 48, now: NOW });

    expect(result).toEqual({
      cancelled: [stale],
      message: "Cancelled 1 card order still unpaid after 48 h.",
    });
    expect(await orderRow(stale)).toMatchObject({
      status: "cancelled",
      paymentStatus: "unpaid",
      cancelReason: "payment_failed",
      cancelledAt: NOW,
    });
    expect(await stock()).toBe(7);
    // The units going back are logged as a cancellation by the job (#130).
    const { listInventoryMovements } = await import("./queries/inventory");
    const ledger = async () =>
      (await listInventoryMovements(testDb.db, variantId)).filter((m) => m.orderId === stale);
    expect(await ledger()).toEqual([
      expect.objectContaining({
        reason: "cancellation",
        quantityDelta: 2,
        stockAfter: 7,
        source: "job",
        occurredAt: NOW,
      }),
    ]);
    expect(
      (await listOrderStatusHistory(testDb.db, stale)).map(({ status, source, changedAt }) => ({
        status,
        source,
        changedAt,
      })),
    ).toEqual([{ status: "cancelled", source: "job", changedAt: NOW }]);
    const queued = await testDb.db
      .select({ entity: cmsOutbox.entity, entityId: cmsOutbox.entityId })
      .from(cmsOutbox);
    expect(queued).toEqual(
      expect.arrayContaining([
        { entity: "order", entityId: stale },
        { entity: "product", entityId: productId },
      ]),
    );

    // The customer is told, in the language they checked out in (#138).
    const { eq } = await import("drizzle-orm");
    const { orderEmails } = await import("./schema");
    const emails = await testDb.db
      .select({ type: orderEmails.type, locale: orderEmails.locale })
      .from(orderEmails)
      .where(eq(orderEmails.orderId, stale));
    expect(emails).toEqual([{ type: "cancelled", locale: "uk" }]);

    // A second run changes nothing.
    expect((await cancelUnpaidOrders(testDb.db, { hours: 48, now: NOW })).cancelled).toEqual([]);
    expect(await stock()).toBe(7);
    expect(await listOrderStatusHistory(testDb.db, stale)).toHaveLength(1);
    expect(await ledger()).toHaveLength(1);
  });

  it("leaves recent, retried, paid and cash-on-delivery orders alone", async () => {
    const { cancelUnpaidOrders } = await import("./cancel-unpaid-orders");
    const recent = await placed(47);
    const retried = await placed(72);
    await attempt(retried, 70, 1);
    await attempt(retried, 0.5, 2);
    const paid = await placed(72, { status: "paid", paymentStatus: "paid", paidAt: hoursAgo(71) });
    const cod = await placed(72, { paymentMethod: "cod" });

    const result = await cancelUnpaidOrders(testDb.db, { hours: 48, now: NOW });

    expect(result).toEqual({
      cancelled: [],
      message: "Cancelled 0 card orders still unpaid after 48 h.",
    });
    for (const orderId of [recent, retried, cod]) {
      expect((await orderRow(orderId))?.status).toBe("pending");
    }
    expect((await orderRow(paid))?.status).toBe("paid");
    expect(await stock()).toBe(5);
  });

  it("gives back what a gift card paid towards the cancelled order", async () => {
    const { cancelUnpaidOrders } = await import("./cancel-unpaid-orders");
    const { findGiftCard, redeemGiftCard } = await import("./queries/gift-cards");
    const { giftCards } = await import("./schema");
    const orderId = await placed(50, { giftCardAmount: "200.00", totalAmount: "800.00" });
    const [card] = await testDb.db
      .insert(giftCards)
      .values({
        code: "UNPAID0000000001",
        initialAmount: "500.00",
        balance: "500.00",
        status: "active",
        buyerEmail: "buyer@example.com",
        locale: "uk",
        activatedAt: hoursAgo(100),
        expiresAt: new Date(NOW.getTime() + 86_400_000 * 300),
      })
      .returning({ id: giftCards.id });
    const cardId = card?.id ?? 0;
    await redeemGiftCard(testDb.db, { giftCardId: cardId, orderId, amount: "200.00" });

    await cancelUnpaidOrders(testDb.db, { hours: 48, now: NOW });

    expect((await findGiftCard(testDb.db, cardId))?.balance).toBe("500.00");
  });
});
