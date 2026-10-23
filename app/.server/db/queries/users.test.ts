import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, pgErrorCode, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("user queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_users_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("inserts a user and finds it by email and id", async () => {
    const { findUserByEmail, findUserById, insertUser } = await import("./users");

    const { id } = await insertUser(testDb.db, {
      fullName: "Olena Petrenko",
      email: "olena@example.com",
      passwordHash: "$argon2id$hash",
    });

    expect(await findUserByEmail(testDb.db, "olena@example.com")).toEqual({
      id,
      passwordHash: "$argon2id$hash",
    });
    expect(await findUserById(testDb.db, id)).toEqual({
      id,
      fullName: "Olena Petrenko",
      email: "olena@example.com",
      role: "customer",
    });
  });

  it("returns undefined for unknown users", async () => {
    const { findUserByEmail, findUserById } = await import("./users");

    expect(await findUserByEmail(testDb.db, "nobody@example.com")).toBeUndefined();
    expect(await findUserById(testDb.db, 999_999)).toBeUndefined();
  });

  it("defaults acquisition_channel to 'direct'", async () => {
    const { insertUser } = await import("./users");
    const { users } = await import("../schema");
    const { eq } = await import("drizzle-orm");

    const { id } = await insertUser(testDb.db, {
      fullName: "Taras",
      email: "taras@example.com",
      passwordHash: "x",
    });
    const [row] = await testDb.db
      .select({ channel: users.acquisitionChannel, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, id));

    expect(row).toEqual({ channel: "direct", lastLoginAt: null });
  });

  it("rejects a duplicate email with 23505", async () => {
    const { insertUser } = await import("./users");
    const values = { fullName: "Dup", email: "dup@example.com", passwordHash: "x" };
    await insertUser(testDb.db, values);

    expect(await pgErrorCode(insertUser(testDb.db, values))).toBe("23505");
  });

  it("sets last_login_at to now", async () => {
    const { insertUser, touchLastLogin } = await import("./users");
    const { users } = await import("../schema");
    const { eq } = await import("drizzle-orm");
    const { id } = await insertUser(testDb.db, {
      fullName: "Login",
      email: "login@example.com",
      passwordHash: "x",
    });

    await touchLastLogin(testDb.db, id);
    const [row] = await testDb.db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, id));

    expect(row?.lastLoginAt).toBeInstanceOf(Date);
    expect(Math.abs((row?.lastLoginAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  it("promotes and demotes a user by email", async () => {
    const { findUserById, insertUser, setUserRole } = await import("./users");
    const { id } = await insertUser(testDb.db, {
      fullName: "Admin",
      email: "admin@example.com",
      passwordHash: "x",
    });

    expect(await setUserRole(testDb.db, "admin@example.com", "admin")).toBe(true);
    expect((await findUserById(testDb.db, id))?.role).toBe("admin");
    expect(await setUserRole(testDb.db, "admin@example.com", "customer")).toBe(true);
    expect((await findUserById(testDb.db, id))?.role).toBe("customer");
  });

  it("reports an unknown email when setting a role", async () => {
    const { setUserRole } = await import("./users");

    expect(await setUserRole(testDb.db, "nobody@example.com", "admin")).toBe(false);
  });
});
