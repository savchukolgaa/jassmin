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
      emailVerified: false,
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

  it("stores the delivery city and the marketing consent (#128)", async () => {
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../schema");
    const { insertUser, setMarketingOptIn, setUserCity } = await import("./users");
    const { id } = await insertUser(testDb.db, {
      fullName: "City",
      email: "city-128@example.com",
      passwordHash: "x",
    });
    const read = async () =>
      (
        await testDb.db
          .select({ city: users.city, marketingOptIn: users.marketingOptIn })
          .from(users)
          .where(eq(users.id, id))
      )[0];

    expect(await read()).toEqual({ city: null, marketingOptIn: false });
    await setUserCity(testDb.db, id, "Дніпро");
    expect(await setMarketingOptIn(testDb.db, id, true)).toBe(true);
    expect(await read()).toEqual({ city: "Дніпро", marketingOptIn: true });
    expect(await setMarketingOptIn(testDb.db, 999_999, true)).toBe(false);
  });

  it("stores the user's language (#139)", async () => {
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../schema");
    const { insertUser, setUserLocale } = await import("./users");
    const { id } = await insertUser(testDb.db, {
      fullName: "Locale",
      email: "locale-139@example.com",
      passwordHash: "x",
    });
    const read = async () =>
      (await testDb.db.select({ locale: users.locale }).from(users).where(eq(users.id, id)))[0];

    expect(await read()).toEqual({ locale: null });
    await setUserLocale(testDb.db, id, "en");
    expect(await read()).toEqual({ locale: "en" });
  });

  it("reads the profile and credentials by id", async () => {
    const { findUserCredentialsById, findUserProfile, insertUser } = await import("./users");
    const { id } = await insertUser(testDb.db, {
      fullName: "Profile",
      email: "profile@example.com",
      passwordHash: "$argon2id$profile",
      phone: "+380 67 123 45 67",
    });

    const profile = await findUserProfile(testDb.db, id);
    expect(profile).toEqual({
      fullName: "Profile",
      email: "profile@example.com",
      phone: "+380 67 123 45 67",
      createdAt: expect.any(Date),
      marketingOptIn: false,
    });
    expect(profile).not.toHaveProperty("passwordHash");
    expect(await findUserCredentialsById(testDb.db, id)).toEqual({
      id,
      passwordHash: "$argon2id$profile",
    });
    expect(await findUserProfile(testDb.db, 999_999)).toBeUndefined();
    expect(await findUserCredentialsById(testDb.db, 999_999)).toBeUndefined();
  });

  it("updates the contact details, email and password hash", async () => {
    const {
      findUserByEmail,
      findUserContact,
      insertUser,
      updateUserContact,
      updateUserEmail,
      setPasswordChanged,
      findSessionUser,
    } = await import("./users");
    const { id } = await insertUser(testDb.db, {
      fullName: "Before",
      email: "before@example.com",
      passwordHash: "old",
      phone: "+380 67 000 00 00",
    });

    expect(await updateUserContact(testDb.db, id, { fullName: "After", phone: null })).toBe(true);
    expect(await updateUserEmail(testDb.db, id, "after@example.com")).toBe(true);
    const changedAt = new Date("2026-11-05T12:00:00Z");
    expect(
      await setPasswordChanged(testDb.db, id, {
        passwordHash: "new",
        changedAt,
        verifyEmail: false,
      }),
    ).toEqual({ email: "after@example.com" });
    // A profile change records the time but doesn't confirm the email; a reset does.
    expect(await findSessionUser(testDb.db, id)).toMatchObject({
      emailVerified: false,
      passwordChangedAt: changedAt,
    });
    await setPasswordChanged(testDb.db, id, { passwordHash: "new", changedAt, verifyEmail: true });
    expect(await findSessionUser(testDb.db, id)).toMatchObject({ emailVerified: true });

    expect(await findUserContact(testDb.db, id)).toEqual({
      fullName: "After",
      email: "after@example.com",
      phone: null,
    });
    expect(await findUserByEmail(testDb.db, "after@example.com")).toEqual({
      id,
      passwordHash: "new",
    });
    expect(await updateUserContact(testDb.db, 999_999, { fullName: "X", phone: null })).toBe(false);
  });

  it("rejects changing to a taken email with 23505", async () => {
    const { insertUser, updateUserEmail } = await import("./users");
    await insertUser(testDb.db, { fullName: "A", email: "taken@example.com", passwordHash: "x" });
    const { id } = await insertUser(testDb.db, {
      fullName: "B",
      email: "free@example.com",
      passwordHash: "x",
    });

    expect(await pgErrorCode(updateUserEmail(testDb.db, id, "taken@example.com"))).toBe("23505");
  });
});
