import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAKE_ADMIN_USAGE, parseMakeAdminArgs } from "./make-admin";
import { hasDatabase, type TestDatabase } from "./test-utils";

describe("parseMakeAdminArgs", () => {
  it("promotes the normalised email", () => {
    expect(parseMakeAdminArgs(["  Olha@Example.COM "])).toEqual({
      ok: true,
      email: "olha@example.com",
      role: "admin",
    });
  });

  it("demotes with --revoke, before or after the email", () => {
    for (const argv of [
      ["--revoke", "a@b.ua"],
      ["a@b.ua", "--revoke"],
      ["--", "a@b.ua", "--revoke"],
    ]) {
      expect(parseMakeAdminArgs(argv)).toEqual({ ok: true, email: "a@b.ua", role: "customer" });
    }
  });

  it("prints the usage without exactly one email", () => {
    for (const argv of [[], ["--revoke"], ["a@b.ua", "c@d.ua"], ["--admin"]]) {
      expect(parseMakeAdminArgs(argv)).toEqual({ ok: false, error: MAKE_ADMIN_USAGE });
    }
  });

  it("rejects an invalid email", () => {
    expect(parseMakeAdminArgs(["not-an-email"])).toEqual({
      ok: false,
      error: "Not a valid email address: not-an-email",
    });
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("makeAdmin", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_make_admin_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("promotes and demotes a registered user", async () => {
    const { makeAdmin } = await import("./make-admin");
    const { findUserById, insertUser } = await import("./queries/users");
    const { id } = await insertUser(testDb.db, {
      fullName: "Olha",
      email: "olha@example.com",
      passwordHash: "x",
    });

    expect(await makeAdmin(testDb.db, { email: "olha@example.com", role: "admin" })).toEqual({
      ok: true,
      message: "olha@example.com is now an admin.",
    });
    expect((await findUserById(testDb.db, id))?.role).toBe("admin");

    expect(await makeAdmin(testDb.db, { email: "olha@example.com", role: "customer" })).toEqual({
      ok: true,
      message: "olha@example.com is no longer an admin (customer).",
    });
    expect((await findUserById(testDb.db, id))?.role).toBe("customer");
  });

  it("explains that an unknown email must register first", async () => {
    const { makeAdmin } = await import("./make-admin");

    expect(await makeAdmin(testDb.db, { email: "nobody@example.com", role: "admin" })).toEqual({
      ok: false,
      message:
        "No user with the email nobody@example.com. Register the account at /register first.",
    });
  });
});
