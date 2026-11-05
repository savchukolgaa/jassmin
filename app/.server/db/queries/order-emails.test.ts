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

const delays = [1, 5, 15] as const;

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("order email queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_order_emails_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders } = await import("../schema");
    // Cascades to order_emails.
    await testDb.db.delete(orders);
  });

  /** An order with a queued confirmation; returns the order id. */
  async function queued(locale: "uk" | "en" = "uk"): Promise<number> {
    const { orders } = await import("../schema");
    const { insertOrderEmail } = await import("./order-emails");
    const [order] = await testDb.db.insert(orders).values(sampleOrder).returning();
    const orderId = order?.id ?? 0;
    await insertOrderEmail(testDb.db, { orderId, type: "confirmation", locale });
    return orderId;
  }

  async function row(orderId: number) {
    const { eq } = await import("drizzle-orm");
    const { orderEmails } = await import("../schema");
    const [email] = await testDb.db
      .select()
      .from(orderEmails)
      .where(eq(orderEmails.orderId, orderId));
    return email;
  }

  /** Minutes from now until the row is due again, rounded. */
  async function minutesUntilDue(orderId: number): Promise<number> {
    const email = await row(orderId);
    return Math.round(((email?.nextAttemptAt.getTime() ?? 0) - Date.now()) / 60_000);
  }

  it("queues a pending email that is due at once", async () => {
    const orderId = await queued("en");
    expect(await row(orderId)).toMatchObject({
      type: "confirmation",
      locale: "en",
      status: "pending",
      attempts: 0,
      lastError: null,
      sentAt: null,
    });
    expect(await minutesUntilDue(orderId)).toBeLessThanOrEqual(0);
  });

  it("allows one email of each type per order", async () => {
    const { insertOrderEmail } = await import("./order-emails");
    const orderId = await queued();
    await expect(
      insertOrderEmail(testDb.db, { orderId, type: "confirmation", locale: "uk" }),
    ).rejects.toThrow();
  });

  it("claims due rows, counts the attempt and pushes the next attempt out", async () => {
    const { claimOrderEmails } = await import("./order-emails");
    const orderId = await queued("en");

    expect(await claimOrderEmails(testDb.db, { limit: 10, retryDelaysMinutes: delays })).toEqual([
      {
        id: expect.any(Number),
        orderId,
        giftCardId: null,
        type: "confirmation",
        locale: "en",
        attempts: 1,
      },
    ]);
    expect(await minutesUntilDue(orderId)).toBe(1);
    // Not due again until then.
    expect(await claimOrderEmails(testDb.db, { limit: 10, retryDelaysMinutes: delays })).toEqual(
      [],
    );
  });

  it("waits longer after each attempt and repeats the last delay", async () => {
    const { sql } = await import("drizzle-orm");
    const { claimOrderEmails } = await import("./order-emails");
    const orderId = await queued();

    for (const expected of [1, 5, 15, 15]) {
      await testDb.db.execute(sql`update order_emails set next_attempt_at = now()`);
      await claimOrderEmails(testDb.db, { limit: 10, retryDelaysMinutes: delays });
      expect(await minutesUntilDue(orderId)).toBe(expected);
    }
    expect((await row(orderId))?.attempts).toBe(4);
  });

  it("claims only the given order and at most `limit` rows, oldest first", async () => {
    const { claimOrderEmails } = await import("./order-emails");
    const first = await queued();
    const second = await queued();
    const third = await queued();

    const onlyThird = await claimOrderEmails(testDb.db, {
      orderId: third,
      limit: 10,
      retryDelaysMinutes: delays,
    });
    expect(onlyThird.map((e) => e.orderId)).toEqual([third]);
    const batch = await claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: delays });
    expect(batch.map((e) => e.orderId)).toEqual([first]);
    expect((await row(second))?.attempts).toBe(0);
  });

  it("never gives the same row to two concurrent senders", async () => {
    const { claimOrderEmails } = await import("./order-emails");
    const ids = [await queued(), await queued(), await queued()];

    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        claimOrderEmails(testDb.db, { limit: 2, retryDelaysMinutes: delays }),
      ),
    );
    const claimed = claims.flat().map((e) => e.orderId);
    expect(claimed.sort()).toEqual([...ids].sort());
  });

  it("marks a sent email and never claims it again", async () => {
    const { sql } = await import("drizzle-orm");
    const { claimOrderEmails, markOrderEmailSent } = await import("./order-emails");
    const orderId = await queued();
    const [claimed] = await claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: delays });

    await markOrderEmailSent(testDb.db, claimed?.id ?? 0);
    expect(await row(orderId)).toMatchObject({ status: "sent", lastError: null });
    expect((await row(orderId))?.sentAt).toBeInstanceOf(Date);
    await testDb.db.execute(sql`update order_emails set next_attempt_at = now()`);
    expect(await claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: delays })).toEqual([]);
  });

  it("keeps a failed email pending for a retry, or stops when the failure is final", async () => {
    const { sql } = await import("drizzle-orm");
    const { claimOrderEmails, markOrderEmailFailed } = await import("./order-emails");
    const orderId = await queued();
    const [claimed] = await claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: delays });
    const id = claimed?.id ?? 0;

    await markOrderEmailFailed(testDb.db, id, { error: "Connection refused", final: false });
    expect(await row(orderId)).toMatchObject({
      status: "pending",
      lastError: "Connection refused",
    });

    await markOrderEmailFailed(testDb.db, id, { error: "Greeting never received", final: true });
    expect(await row(orderId)).toMatchObject({
      status: "failed",
      lastError: "Greeting never received",
    });
    await testDb.db.execute(sql`update order_emails set next_attempt_at = now()`);
    expect(await claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: delays })).toEqual([]);
  });

  it("rejects retry delays that aren't whole positive minutes", async () => {
    const { claimOrderEmails } = await import("./order-emails");
    expect(() => claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: [] })).toThrow();
    expect(() => claimOrderEmails(testDb.db, { limit: 1, retryDelaysMinutes: [1.5] })).toThrow();
  });
});
