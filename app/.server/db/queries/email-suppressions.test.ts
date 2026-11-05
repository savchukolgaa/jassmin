import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, pgErrorCode, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("email suppression queries (#134)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_email_suppressions_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { emailSuppressions } = await import("../schema");
    await testDb.db.delete(emailSuppressions);
  });

  async function rows() {
    const { emailSuppressions } = await import("../schema");
    return testDb.db.select().from(emailSuppressions).orderBy(emailSuppressions.address);
  }

  it("stores addresses lowercase and keeps the first reason", async () => {
    const { suppressEmails } = await import("./email-suppressions");

    expect(
      await suppressEmails(testDb.db, [
        { address: " Olena@Example.com ", reason: "hard_bounce", detail: "550 no such user" },
        { address: "olena@example.com", reason: "complaint" },
        { address: "spam@example.com", reason: "complaint" },
      ]),
    ).toBe(2);
    expect(
      await suppressEmails(testDb.db, [{ address: "OLENA@example.com", reason: "blocked" }]),
    ).toBe(0);

    expect(await rows()).toMatchObject([
      { address: "olena@example.com", reason: "hard_bounce", detail: "550 no such user" },
      { address: "spam@example.com", reason: "complaint", detail: null },
    ]);
  });

  it("cuts a long detail and ignores an empty list", async () => {
    const { suppressEmails } = await import("./email-suppressions");

    expect(await suppressEmails(testDb.db, [])).toBe(0);
    await suppressEmails(testDb.db, [
      { address: "a@example.com", reason: "invalid", detail: "x".repeat(900) },
    ]);
    expect((await rows())[0]?.detail).toHaveLength(500);
  });

  it("finds which addresses are suppressed, whatever their case", async () => {
    const { findEmailSuppressions, suppressEmails } = await import("./email-suppressions");
    await suppressEmails(testDb.db, [{ address: "olena@example.com", reason: "hard_bounce" }]);

    const found = await findEmailSuppressions(testDb.db, ["Olena@Example.com", "ok@example.com"]);
    expect([...found]).toEqual([["olena@example.com", "hard_bounce"]]);
    expect((await findEmailSuppressions(testDb.db, [])).size).toBe(0);
  });

  it("refuses an unknown reason and an uppercase address in the table itself", async () => {
    const { emailSuppressions } = await import("../schema");

    expect(
      await pgErrorCode(
        testDb.db.insert(emailSuppressions).values({ address: "A@example.com", reason: "invalid" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        testDb.db
          .insert(emailSuppressions)
          // @ts-expect-error: not a suppression reason
          .values({ address: "a@example.com", reason: "soft_bounce" }),
      ),
    ).toBe("23514");
  });
});
