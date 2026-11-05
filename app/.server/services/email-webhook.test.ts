import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

beforeAll(() => {
  // `services/email-webhook.ts` imports the app pool for its default; tests pass their own.
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || "postgres://u:p@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

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
describe.skipIf(!hasDatabase)("applyEmailEvents (#134)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_email_webhook_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { emailSuppressions, orders } = await import("../db/schema");
    await testDb.db.delete(orders);
    await testDb.db.delete(emailSuppressions);
  });

  /** A sent order confirmation with this Message-ID; returns its `order_emails` id. */
  async function sentEmail(messageId: string): Promise<number> {
    const { orderEmails, orders } = await import("../db/schema");
    const [order] = await testDb.db.insert(orders).values(sampleOrder).returning();
    const [email] = await testDb.db
      .insert(orderEmails)
      .values({
        orderId: order?.id ?? 0,
        type: "confirmation",
        locale: "uk",
        status: "sent",
        messageId,
      })
      .returning();
    return email?.id ?? 0;
  }

  async function emailRow(id: number) {
    const { eq } = await import("drizzle-orm");
    const { orderEmails } = await import("../db/schema");
    const [row] = await testDb.db.select().from(orderEmails).where(eq(orderEmails.id, id));
    return row;
  }

  it("suppresses the addresses and fails the order emails they bounced from", async () => {
    const { applyEmailEvents } = await import("./email-webhook");
    const { findEmailSuppressions } = await import("../db/queries/email-suppressions");
    const tagged = await sentEmail("<rewritten@smtp-relay.brevo.com>");
    const byMessageId = await sentEmail("<two@jassmin.ua>");
    const untouched = await sentEmail("<three@jassmin.ua>");

    const result = await applyEmailEvents(
      [
        {
          address: "Buyer@Example.com",
          reason: "hard_bounce",
          detail: "550 User unknown",
          orderEmailId: tagged,
          messageId: "<something-else@jassmin.ua>",
        },
        {
          address: "other@example.com",
          reason: "complaint",
          detail: null,
          messageId: "<two@jassmin.ua>",
        },
        { address: "nobody@example.com", reason: "blocked", detail: null },
      ],
      testDb.db,
    );

    expect(result).toEqual({ suppressed: 3, bounced: 2 });
    expect(await emailRow(tagged)).toMatchObject({
      status: "failed",
      lastError: "hard_bounce: 550 User unknown",
    });
    expect(await emailRow(byMessageId)).toMatchObject({ status: "failed", lastError: "complaint" });
    expect(await emailRow(untouched)).toMatchObject({ status: "sent" });
    const suppressed = await findEmailSuppressions(testDb.db, [
      "buyer@example.com",
      "other@example.com",
      "nobody@example.com",
    ]);
    expect([...suppressed.values()].sort()).toEqual(["blocked", "complaint", "hard_bounce"]);
  });

  it("does nothing for no events, and a repeated event changes nothing", async () => {
    const { applyEmailEvents } = await import("./email-webhook");
    const event = { address: "a@example.com", reason: "hard_bounce", detail: null } as const;

    expect(await applyEmailEvents([], testDb.db)).toEqual({ suppressed: 0, bounced: 0 });
    expect(await applyEmailEvents([event], testDb.db)).toEqual({ suppressed: 1, bounced: 0 });
    expect(await applyEmailEvents([event], testDb.db)).toEqual({ suppressed: 0, bounced: 0 });
  });
});
