import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "./test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("pruneRateLimitsJob", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_prune_rate_limits_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("deletes ended windows only, and a second run deletes nothing", async () => {
    const { rateLimits } = await import("./schema");
    const { pruneRateLimitsJob } = await import("./prune-rate-limits");
    const now = new Date("2026-11-05T12:00:00Z");
    await testDb.db.insert(rateLimits).values([
      { key: "a", count: 3, resetAt: new Date("2026-11-05T11:00:00Z") },
      { key: "b", count: 1, resetAt: new Date("2026-11-05T11:59:59Z") },
      { key: "c", count: 2, resetAt: new Date("2026-11-05T12:10:00Z") },
    ]);

    expect(await pruneRateLimitsJob(testDb.db, now)).toEqual({
      deleted: 2,
      message: "Deleted 2 ended rate limit windows.",
    });
    expect((await pruneRateLimitsJob(testDb.db, now)).deleted).toBe(0);
    const keys = await testDb.db.select({ key: rateLimits.key }).from(rateLimits);
    expect(keys).toEqual([{ key: "c" }]);
  });
});
