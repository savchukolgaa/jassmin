import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "./test-utils";

const NOW = new Date("2027-11-05T10:00:00Z");

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("expireGiftCardsJob", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_expire_gift_cards_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("expires active cards past their date, queues them for Strapi and leaves the rest", async () => {
    const { expireGiftCardsJob } = await import("./expire-gift-cards");
    const { cmsOutbox, giftCards } = await import("./schema");
    const card = (code: string, expiresAt: Date, status: "active" | "used_up" = "active") => ({
      code,
      initialAmount: "500.00",
      balance: status === "used_up" ? "0.00" : "500.00",
      status,
      buyerEmail: "buyer@example.com",
      locale: "uk" as const,
      activatedAt: new Date("2026-11-05T10:00:00Z"),
      expiresAt,
    });
    const rows = await testDb.db
      .insert(giftCards)
      .values([
        card("EXP0000000000001", NOW),
        card("EXP0000000000002", new Date("2027-11-05T10:00:01Z")),
        card("EXP0000000000003", NOW, "used_up"),
      ])
      .returning({ id: giftCards.id, code: giftCards.code });
    const due = rows[0]?.id;

    expect(await expireGiftCardsJob(testDb.db, NOW)).toEqual({
      expired: [due],
      message: "Marked 1 gift card past their date as expired.",
    });
    const states = await testDb.db
      .select({ code: giftCards.code, status: giftCards.status })
      .from(giftCards)
      .orderBy(giftCards.code);
    expect(states.map((row) => row.status)).toEqual(["expired", "active", "used_up"]);
    expect(
      await testDb.db.select({ entity: cmsOutbox.entity, id: cmsOutbox.entityId }).from(cmsOutbox),
    ).toEqual([{ entity: "gift_card", id: due }]);

    expect((await expireGiftCardsJob(testDb.db, NOW)).message).toBe(
      "Marked 0 gift cards past their date as expired.",
    );
  });
});
