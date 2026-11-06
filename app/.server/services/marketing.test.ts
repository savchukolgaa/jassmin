import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import { createUnsubscribeToken } from "../unsubscribe-token";
import { inspectUnsubscribeToken } from "./marketing";

const secret = "m".repeat(32);
const env = { EMAIL_UNSUBSCRIBE_SECRET: secret };

describe("inspectUnsubscribeToken", () => {
  it("names the token's user, and nobody without the secret", () => {
    const token = createUnsubscribeToken(7, secret);
    expect(inspectUnsubscribeToken(token, { env })).toBe(7);
    expect(inspectUnsubscribeToken(token, { env: {} })).toBeUndefined();
    expect(
      inspectUnsubscribeToken(token, { env: { EMAIL_UNSUBSCRIBE_SECRET: "x".repeat(32) } }),
    ).toBe(undefined);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("unsubscribeMarketing", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_marketing_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  async function optIn(userId: number) {
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../db/schema");
    const [row] = await testDb.db
      .select({ optIn: users.marketingOptIn })
      .from(users)
      .where(eq(users.id, userId));
    return row?.optIn;
  }

  it("withdraws the user's consent, and a second time is fine", async () => {
    const { users } = await import("../db/schema");
    const { unsubscribeMarketing } = await import("./marketing");
    const [user] = await testDb.db
      .insert(users)
      .values({ fullName: "O", email: "opt@example.com", passwordHash: "x", marketingOptIn: true })
      .returning({ id: users.id });
    const id = user?.id ?? 0;
    const token = createUnsubscribeToken(id, secret);

    expect(await unsubscribeMarketing(token, { db: testDb.db, env })).toEqual({ ok: true });
    expect(await optIn(id)).toBe(false);
    expect(await unsubscribeMarketing(token, { db: testDb.db, env })).toEqual({ ok: true });
  });

  it("refuses a forged token and a deleted user without writing", async () => {
    const { users } = await import("../db/schema");
    const { unsubscribeMarketing } = await import("./marketing");
    const [user] = await testDb.db
      .insert(users)
      .values({ fullName: "O", email: "keep@example.com", passwordHash: "x", marketingOptIn: true })
      .returning({ id: users.id });
    const id = user?.id ?? 0;
    const forged = createUnsubscribeToken(id, "f".repeat(32));

    expect(await unsubscribeMarketing(forged, { db: testDb.db, env })).toEqual({
      ok: false,
      error: "invalid-token",
    });
    expect(await optIn(id)).toBe(true);
    expect(
      await unsubscribeMarketing(createUnsubscribeToken(999_999, secret), { db: testDb.db, env }),
    ).toEqual({ ok: false, error: "invalid-token" });
  });
});
