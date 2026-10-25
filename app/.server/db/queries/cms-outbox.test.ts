import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

const delays = [1, 5] as const;

/** Claims in entity, then id order (`UPDATE … RETURNING` has no order). */
function sorted<T extends { entity: string; entityId: number }>(claims: T[]): T[] {
  return [...claims].sort((a, b) => a.entity.localeCompare(b.entity) || a.entityId - b.entityId);
}

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cms outbox queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_cms_outbox_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { cmsOutbox } = await import("../schema");
    await testDb.db.delete(cmsOutbox);
  });

  async function rows() {
    const { asc } = await import("drizzle-orm");
    const { cmsOutbox } = await import("../schema");
    return testDb.db
      .select()
      .from(cmsOutbox)
      .orderBy(asc(cmsOutbox.entity), asc(cmsOutbox.entityId));
  }

  it("queues each entity once and bumps the version when it is queued again", async () => {
    const { enqueueCmsSync } = await import("./cms-outbox");

    await enqueueCmsSync(testDb.db, "order", [7, 7, 8]);
    await enqueueCmsSync(testDb.db, "order", [7]);
    await enqueueCmsSync(testDb.db, "product", []);

    expect((await rows()).map((r) => [r.entity, r.entityId, r.version, r.syncedAt])).toEqual([
      ["order", 7, 2, null],
      ["order", 8, 1, null],
    ]);
  });

  it("claims due rows once, counts the attempt and leases them until the retry time", async () => {
    const { claimCmsSync, enqueueCmsSync } = await import("./cms-outbox");
    await enqueueCmsSync(testDb.db, "order", [1]);
    await enqueueCmsSync(testDb.db, "product", [2]);

    const claimed = sorted(
      await claimCmsSync(testDb.db, { limit: 10, retryDelaysMinutes: delays }),
    );
    expect(claimed.map((c) => [c.entity, c.entityId, c.attempts])).toEqual([
      ["order", 1, 1],
      ["product", 2, 1],
    ]);
    expect(await claimCmsSync(testDb.db, { limit: 10, retryDelaysMinutes: delays })).toEqual([]);
    const [row] = await rows();
    expect(Math.round(((row?.nextAttemptAt.getTime() ?? 0) - Date.now()) / 60_000)).toBe(1);
  });

  it("claims only the given entities", async () => {
    const { claimCmsSync, enqueueCmsSync } = await import("./cms-outbox");
    await enqueueCmsSync(testDb.db, "order", [1, 2]);
    await enqueueCmsSync(testDb.db, "product", [1]);

    const claimed = sorted(
      await claimCmsSync(testDb.db, {
        only: [
          { entity: "order", ids: [2] },
          { entity: "product", ids: [1] },
        ],
        limit: 10,
        retryDelaysMinutes: delays,
      }),
    );
    expect(claimed.map((c) => [c.entity, c.entityId])).toEqual([
      ["order", 2],
      ["product", 1],
    ]);
    expect(
      await claimCmsSync(testDb.db, { only: [], limit: 10, retryDelaysMinutes: delays }),
    ).toEqual([]);
  });

  it("marks only the claimed version as synced or failed", async () => {
    const { claimCmsSync, enqueueCmsSync, markCmsSynced, markCmsSyncFailed } = await import(
      "./cms-outbox"
    );
    await enqueueCmsSync(testDb.db, "order", [1, 2, 3]);
    const [first, second, third] = sorted(
      await claimCmsSync(testDb.db, { limit: 10, retryDelaysMinutes: delays }),
    );
    if (!first || !second || !third) throw new Error("expected three claims");

    // Order 2 changes again while its push is in flight; order 3's push fails.
    await enqueueCmsSync(testDb.db, "order", [2]);
    await markCmsSynced(testDb.db, first.id, first.version);
    await markCmsSynced(testDb.db, second.id, second.version);
    await markCmsSyncFailed(testDb.db, second.id, second.version, "stale");
    await markCmsSyncFailed(testDb.db, third.id, third.version, "Strapi answered 500");

    const [one, two, three] = await rows();
    expect(one?.syncedAt).toBeInstanceOf(Date);
    expect(two).toMatchObject({ syncedAt: null, version: 2, attempts: 0, lastError: null });
    expect(three).toMatchObject({ syncedAt: null, attempts: 1, lastError: "Strapi answered 500" });
    const again = await claimCmsSync(testDb.db, { limit: 10, retryDelaysMinutes: delays });
    expect(again.map((c) => [c.entityId, c.version])).toEqual([[2, 2]]);
  });

  it("queues every product and order", async () => {
    const { orders, products } = await import("../schema");
    const { enqueueAllForCmsSync } = await import("./cms-outbox");
    const [product] = await testDb.db
      .insert(products)
      .values({ title: "P", brand: "B", gender: "women", price: "1.00", volumeMl: 10 })
      .returning();
    const [order] = await testDb.db
      .insert(orders)
      .values({
        guestFullName: "A",
        guestEmail: "a@example.com",
        guestPhone: "+380",
        shippingAddress: "Kyiv",
        paymentMethod: "cod",
        subtotal: "1.00",
        totalAmount: "1.00",
      })
      .returning();

    await enqueueAllForCmsSync(testDb.db);

    expect((await rows()).map((r) => [r.entity, r.entityId])).toEqual([
      ["order", order?.id],
      ["product", product?.id],
    ]);
  });
});
