import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, pgErrorCode, type TestDatabase } from "../test-utils";

const sampleOrder = {
  guestFullName: "Test Buyer",
  guestEmail: "buyer@example.com",
  guestPhone: "+380501234567",
  shippingAddress: "Kyiv, Nova Poshta branch 1",
  paymentMethod: "cod",
  subtotal: "1500.00",
  totalAmount: "1500.00",
} as const;

const NOW = new Date("2026-11-05T10:00:00Z");

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("gift card queries", () => {
  let testDb: TestDatabase;
  let codes = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_gift_cards_queries_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { giftCardRedemptions, giftCards, orders, payments } = await import("../schema");
    await testDb.db.delete(giftCardRedemptions);
    await testDb.db.delete(orders);
    await testDb.db.delete(payments);
    await testDb.db.delete(giftCards);
  });

  async function card(initialAmount = "1000.00", buyerUserId: number | null = null) {
    const { insertGiftCard } = await import("./gift-cards");
    codes += 1;
    return insertGiftCard(testDb.db, {
      code: `CODE${String(codes).padStart(12, "0")}`,
      initialAmount,
      buyerUserId,
      buyerEmail: "buyer@example.com",
      recipientEmail: null,
      locale: "uk",
    });
  }

  async function paidCard(initialAmount = "1000.00") {
    const { activateGiftCard } = await import("./gift-cards");
    const { payments } = await import("../schema");
    const id = await card(initialAmount);
    const [payment] = await testDb.db
      .insert(payments)
      .values({
        giftCardId: id,
        provider: "simulator",
        reference: `G${id}-1`,
        amount: initialAmount,
      })
      .returning({ id: payments.id });
    await activateGiftCard(testDb.db, id, { paymentId: payment?.id ?? 0, now: NOW });
    return { id, paymentId: payment?.id ?? 0 };
  }

  async function order() {
    const { orders } = await import("../schema");
    const [row] = await testDb.db.insert(orders).values(sampleOrder).returning({ id: orders.id });
    return row?.id ?? 0;
  }

  it("creates a pending card with its full balance and finds it by code", async () => {
    const { findGiftCard, findGiftCardByCode } = await import("./gift-cards");
    const id = await card("500.00");
    const stored = await findGiftCard(testDb.db, id);
    expect(stored).toMatchObject({
      status: "pending",
      initialAmount: "500.00",
      balance: "500.00",
      activatedAt: null,
      expiresAt: null,
    });
    expect((await findGiftCardByCode(testDb.db, stored?.code ?? ""))?.id).toBe(id);
    expect(await findGiftCardByCode(testDb.db, "NOPE000000000000")).toBeUndefined();
  });

  it("activates a pending card once, for 12 months from its payment", async () => {
    const { activateGiftCard, findGiftCard } = await import("./gift-cards");
    const { id, paymentId } = await paidCard();
    expect(await findGiftCard(testDb.db, id)).toMatchObject({
      status: "active",
      paymentId,
      activatedAt: NOW,
      expiresAt: new Date("2027-11-05T10:00:00Z"),
    });
    // A repeated callback changes nothing.
    expect(
      await activateGiftCard(testDb.db, id, { paymentId, now: new Date("2026-12-01T00:00:00Z") }),
    ).toBeUndefined();
    expect((await findGiftCard(testDb.db, id))?.activatedAt).toEqual(NOW);
  });

  it("takes amounts off the balance until it's used up, and never below 0", async () => {
    const { findGiftCard, redeemGiftCard } = await import("./gift-cards");
    const { id } = await paidCard("500.00");
    await redeemGiftCard(testDb.db, { giftCardId: id, orderId: await order(), amount: "200.00" });
    expect(await findGiftCard(testDb.db, id)).toMatchObject({
      balance: "300.00",
      status: "active",
    });

    expect(
      await pgErrorCode(
        redeemGiftCard(testDb.db, { giftCardId: id, orderId: await order(), amount: "300.01" }),
      ),
    ).toBe("23514");

    await redeemGiftCard(testDb.db, { giftCardId: id, orderId: await order(), amount: "300.00" });
    expect(await findGiftCard(testDb.db, id)).toMatchObject({ balance: "0.00", status: "used_up" });
  });

  it("gives an order's redemptions back once, reactivating a used-up card", async () => {
    const { findGiftCard, redeemGiftCard, restoreGiftCardRedemptions } = await import(
      "./gift-cards"
    );
    const { id } = await paidCard("500.00");
    const orderId = await order();
    await redeemGiftCard(testDb.db, { giftCardId: id, orderId, amount: "500.00" });

    expect(await restoreGiftCardRedemptions(testDb.db, orderId, NOW)).toEqual([id]);
    expect(await findGiftCard(testDb.db, id)).toMatchObject({
      balance: "500.00",
      status: "active",
    });
    // Twice changes nothing.
    expect(await restoreGiftCardRedemptions(testDb.db, orderId, NOW)).toEqual([]);
    expect((await findGiftCard(testDb.db, id))?.balance).toBe("500.00");
  });

  it("keeps an expired card expired when its amount comes back", async () => {
    const { findGiftCard, redeemGiftCard, restoreGiftCardRedemptions } = await import(
      "./gift-cards"
    );
    const { id } = await paidCard("500.00");
    const orderId = await order();
    await redeemGiftCard(testDb.db, { giftCardId: id, orderId, amount: "500.00" });

    expect(await restoreGiftCardRedemptions(testDb.db, orderId, new Date("2028-01-01"))).toEqual([
      id,
    ]);
    expect(await findGiftCard(testDb.db, id)).toMatchObject({
      balance: "500.00",
      status: "used_up",
    });
  });

  it("marks active cards past their date expired, and only those", async () => {
    const { findGiftCard, markExpiredGiftCards } = await import("./gift-cards");
    const { id } = await paidCard();
    const pending = await card();

    expect(await markExpiredGiftCards(testDb.db, new Date("2027-11-05T09:59:59Z"))).toEqual([]);
    expect(await markExpiredGiftCards(testDb.db, new Date("2027-11-05T10:00:00Z"))).toEqual([id]);
    expect((await findGiftCard(testDb.db, id))?.status).toBe("expired");
    expect((await findGiftCard(testDb.db, pending))?.status).toBe("pending");
  });

  it("lists a user's cards, newest first, and loads a card with its redemptions", async () => {
    const { findGiftCardSyncState, listUserGiftCards, redeemGiftCard } = await import(
      "./gift-cards"
    );
    const { users } = await import("../schema");
    const [user] = await testDb.db
      .insert(users)
      .values({ fullName: "Buyer", email: `buyer${codes}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const first = await card("500.00", user?.id ?? null);
    const second = await card("2000.00", user?.id ?? null);
    await card();
    expect((await listUserGiftCards(testDb.db, user?.id ?? 0)).map((c) => c.id)).toEqual([
      second,
      first,
    ]);

    const { id } = await paidCard();
    const orderId = await order();
    await redeemGiftCard(testDb.db, { giftCardId: id, orderId, amount: "150.00" });
    const state = await findGiftCardSyncState(testDb.db, id);
    expect(state?.card.balance).toBe("850.00");
    expect(state?.redemptions).toEqual([
      expect.objectContaining({ orderId, amount: "150.00", reversedAt: null }),
    ]);
  });
});
