import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePerfumerChatRetentionDays } from "./prune-perfumer-chats";
import { hasDatabase, type TestDatabase } from "./test-utils";

describe("parsePerfumerChatRetentionDays (#180)", () => {
  it("defaults to 90 days, also for an empty value", () => {
    expect(parsePerfumerChatRetentionDays({})).toEqual({ ok: true, days: 90 });
    expect(parsePerfumerChatRetentionDays({ PERFUMER_CHAT_RETENTION_DAYS: "" })).toEqual({
      ok: true,
      days: 90,
    });
    expect(parsePerfumerChatRetentionDays({ PERFUMER_CHAT_RETENTION_DAYS: "30" })).toEqual({
      ok: true,
      days: 30,
    });
  });

  it.each(["0", "-5", "1.5", "ninety"])("refuses %s", (value) => {
    expect(parsePerfumerChatRetentionDays({ PERFUMER_CHAT_RETENTION_DAYS: value })).toMatchObject({
      ok: false,
    });
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("prunePerfumerChatsJob (#180)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_prune_perfumer_chats_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("deletes chats idle for longer than the retention, deleted ones too, and nothing twice", async () => {
    const { perfumerMessages, perfumerThreads } = await import("./schema");
    const { prunePerfumerChatsJob } = await import("./prune-perfumer-chats");
    const now = new Date("2026-11-19T03:45:00Z");
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

    const threads = await testDb.db
      .insert(perfumerThreads)
      .values([
        { anonymousId: "old", entry: "direct", updatedAt: daysAgo(91) },
        {
          anonymousId: "deleted",
          entry: "direct",
          updatedAt: daysAgo(95),
          closedAt: daysAgo(95),
          deletedAt: daysAgo(95),
        },
        { anonymousId: "recent", entry: "menu", updatedAt: daysAgo(89) },
        // Deleted recently: hidden from the customer, kept until its 90 days are over.
        {
          anonymousId: "just-deleted",
          entry: "direct",
          updatedAt: daysAgo(1),
          closedAt: daysAgo(1),
          deletedAt: daysAgo(1),
        },
      ])
      .returning({ id: perfumerThreads.id, anonymousId: perfumerThreads.anonymousId });
    await testDb.db
      .insert(perfumerMessages)
      .values(threads.map(({ id }) => ({ threadId: id, role: "user" as const, text: "Привіт" })));

    expect(await prunePerfumerChatsJob(testDb.db, { days: 90, now })).toEqual({
      deleted: 2,
      message: "Deleted 2 perfumer chats not updated for 90 days.",
    });
    expect((await prunePerfumerChatsJob(testDb.db, { days: 90, now })).deleted).toBe(0);

    const left = await testDb.db
      .select({ anonymousId: perfumerThreads.anonymousId })
      .from(perfumerThreads)
      .orderBy(perfumerThreads.id);
    expect(left).toEqual([{ anonymousId: "recent" }, { anonymousId: "just-deleted" }]);
    // The deleted chats' messages went with them.
    expect(await testDb.db.select().from(perfumerMessages)).toHaveLength(2);
  });
});
