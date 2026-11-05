import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthTokenPurpose } from "~/lib/enums";
import { hasDatabase, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("auth token queries", () => {
  let testDb: TestDatabase;
  let userId: number;
  const now = new Date("2026-11-05T12:00:00Z");
  const inAnHour = new Date("2026-11-05T13:00:00Z");

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    const { insertUser } = await import("./users");
    testDb = await createTestDatabase("jassmin_auth_tokens_test");
    await migrateLatest(testDb.db);
    ({ id: userId } = await insertUser(testDb.db, {
      fullName: "Token Owner",
      email: "owner@example.com",
      passwordHash: "$argon2id$hash",
    }));
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  async function issue(
    hash: string,
    purpose: AuthTokenPurpose = "password_reset",
    expiresAt = inAnHour,
  ): Promise<void> {
    const { insertAuthToken } = await import("./auth-tokens");
    await insertAuthToken(testDb.db, { userId, purpose, hash, expiresAt });
  }

  it("inspects a token without using it", async () => {
    const { inspectAuthToken } = await import("./auth-tokens");
    await issue("a".repeat(64));

    const valid = { ok: true, userId };
    expect(await inspectAuthToken(testDb.db, "password_reset", "a".repeat(64), now)).toEqual(valid);
    expect(await inspectAuthToken(testDb.db, "password_reset", "a".repeat(64), now)).toEqual(valid);
  });

  it("rejects unknown, expired and other-purpose tokens", async () => {
    const { inspectAuthToken } = await import("./auth-tokens");
    await issue("b".repeat(64));

    expect(await inspectAuthToken(testDb.db, "password_reset", "f".repeat(64), now)).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(await inspectAuthToken(testDb.db, "email_verification", "b".repeat(64), now)).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(await inspectAuthToken(testDb.db, "password_reset", "b".repeat(64), inAnHour)).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("consumes a token once", async () => {
    const { consumeAuthToken } = await import("./auth-tokens");
    await issue("c".repeat(64));

    const first = await testDb.db.transaction((tx) =>
      consumeAuthToken(tx, "password_reset", "c".repeat(64), now),
    );
    expect(first).toEqual({ ok: true, userId });
    const second = await testDb.db.transaction((tx) =>
      consumeAuthToken(tx, "password_reset", "c".repeat(64), now),
    );
    expect(second).toEqual({ ok: false, error: "used" });
  });

  it("lets only one of two concurrent consumes succeed", async () => {
    const { consumeAuthToken } = await import("./auth-tokens");
    await issue("d".repeat(64));

    const results = await Promise.all(
      [1, 2].map(() =>
        testDb.db.transaction((tx) => consumeAuthToken(tx, "password_reset", "d".repeat(64), now)),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "used" }]);
  });

  it("invalidates a user's unused tokens of one purpose", async () => {
    const { inspectAuthToken, invalidateUserTokens } = await import("./auth-tokens");
    await issue("e".repeat(64));
    await issue("9".repeat(64), "email_verification");

    await invalidateUserTokens(testDb.db, userId, "password_reset", now);

    expect(await inspectAuthToken(testDb.db, "password_reset", "e".repeat(64), now)).toEqual({
      ok: false,
      error: "used",
    });
    expect(await inspectAuthToken(testDb.db, "email_verification", "9".repeat(64), now)).toEqual({
      ok: true,
      userId,
    });
  });
});
