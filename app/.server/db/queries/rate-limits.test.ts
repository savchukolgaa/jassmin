import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

const WINDOW_MS = 60_000;
const start = new Date("2026-11-05T10:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("rate limit queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_rate_limits_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { rateLimits } = await import("../schema");
    await testDb.db.delete(rateLimits);
  });

  it("starts a window on the first hit and counts the next ones in it", async () => {
    const { hitRateLimit, readRateLimit } = await import("./rate-limits");

    expect(await hitRateLimit(testDb.db, "k", WINDOW_MS, start)).toEqual({
      count: 1,
      resetAt: at(WINDOW_MS),
    });
    expect(await hitRateLimit(testDb.db, "k", WINDOW_MS, at(1000))).toEqual({
      count: 2,
      resetAt: at(WINDOW_MS),
    });
    expect(await readRateLimit(testDb.db, "k")).toEqual({ count: 2, resetAt: at(WINDOW_MS) });
    expect(await readRateLimit(testDb.db, "other")).toBeUndefined();
  });

  it("restarts the window at 1 once it has ended", async () => {
    const { hitRateLimit } = await import("./rate-limits");
    await hitRateLimit(testDb.db, "k", WINDOW_MS, start);
    await hitRateLimit(testDb.db, "k", WINDOW_MS, start);

    expect(await hitRateLimit(testDb.db, "k", WINDOW_MS, at(WINDOW_MS))).toEqual({
      count: 1,
      resetAt: at(2 * WINDOW_MS),
    });
  });

  it("counts concurrent hits on one key exactly", async () => {
    const { hitRateLimit, readRateLimit } = await import("./rate-limits");

    const results = await Promise.all(
      Array.from({ length: 50 }, () => hitRateLimit(testDb.db, "busy", WINDOW_MS, start)),
    );

    expect((await readRateLimit(testDb.db, "busy"))?.count).toBe(50);
    expect(new Set(results.map((result) => result.count)).size).toBe(50);
  });

  it("deletes a key and prunes only ended windows", async () => {
    const { deleteRateLimit, hitRateLimit, pruneRateLimits, readRateLimit } = await import(
      "./rate-limits"
    );
    await hitRateLimit(testDb.db, "old", WINDOW_MS, start);
    await hitRateLimit(testDb.db, "current", WINDOW_MS, at(WINDOW_MS));
    await hitRateLimit(testDb.db, "gone", WINDOW_MS, at(WINDOW_MS));

    await deleteRateLimit(testDb.db, "gone");
    expect(await readRateLimit(testDb.db, "gone")).toBeUndefined();

    expect(await pruneRateLimits(testDb.db, at(WINDOW_MS + 1))).toBe(1);
    expect(await readRateLimit(testDb.db, "old")).toBeUndefined();
    expect(await readRateLimit(testDb.db, "current")).toBeDefined();
  });
});
