import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

const cart = vi.hoisted(() => ({ mergeGuestCart: vi.fn() }));
const analytics = vi.hoisted(() => ({ readVisitor: vi.fn() }));

vi.mock("./cart", () => cart);
vi.mock("../analytics", () => analytics);

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || "postgres://u:p@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function cookieFor(userId: number): Promise<string> {
  const { commitSession, getSession } = await import("../session");
  const session = await getSession();
  session.set("userId", userId);
  return (await commitSession(session)).split(";")[0] ?? "";
}

describe("onUserAuthenticated", () => {
  const request = new Request("http://localhost/login", { method: "POST" });
  const ANONYMOUS_ID = "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11";

  it("merges the visitor's guest cart into the user's", async () => {
    analytics.readVisitor.mockResolvedValueOnce({ anonymousId: ANONYMOUS_ID });
    const { onUserAuthenticated } = await import("./auth");

    await onUserAuthenticated(request, 5, "login");

    expect(analytics.readVisitor).toHaveBeenCalledWith(request);
    expect(cart.mergeGuestCart).toHaveBeenCalledWith(5, ANONYMOUS_ID);
  });

  it("skips the merge for a visitor without a visitor cookie", async () => {
    cart.mergeGuestCart.mockClear();
    analytics.readVisitor.mockResolvedValueOnce({});
    const { onUserAuthenticated } = await import("./auth");

    await onUserAuthenticated(request, 5, "register");

    expect(cart.mergeGuestCart).not.toHaveBeenCalled();
  });

  it("never makes logging in fail", async () => {
    analytics.readVisitor.mockResolvedValueOnce({ anonymousId: ANONYMOUS_ID });
    cart.mergeGuestCart.mockRejectedValueOnce(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { onUserAuthenticated } = await import("./auth");

    await expect(onUserAuthenticated(request, 5, "login")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("requireUser", () => {
  it("redirects a logged-out visitor to login with the current page as redirectTo", async () => {
    const { requireUser } = await import("./auth");

    const thrown = await requireUser(new Request("http://localhost/account?tab=orders")).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?redirectTo=%2Faccount%3Ftab%3Dorders");
  });
});

describe("requireAdmin", () => {
  it("redirects a logged-out visitor to login like requireUser", async () => {
    const { requireAdmin } = await import("./auth");

    const thrown = await requireAdmin(new Request("http://localhost/admin/orders?x=1")).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/login?redirectTo=%2Fadmin%2Forders%3Fx%3D1",
    );
  });
});

// Integration tests: run only when a database is configured, on their own throwaway database.
describe.skipIf(!hasDatabase)("auth service", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_auth_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  async function readUser(id: number) {
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await testDb.db.select().from(users).where(eq(users.id, id));
    return row;
  }

  it("registers a user with a hashed password and a login time", async () => {
    const { registerUser } = await import("./auth");

    const result = await registerUser(testDb.db, {
      fullName: "Olena",
      email: "olena@example.com",
      password: "correct horse",
      acquisitionChannel: "instagram",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await readUser(result.userId);
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain("correct horse");
    expect(row?.acquisitionChannel).toBe("instagram");
    expect(row?.phone).toBeNull();
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("keeps the 'direct' default without a channel", async () => {
    const { registerUser } = await import("./auth");

    const result = await registerUser(testDb.db, {
      fullName: "Taras",
      email: "taras@example.com",
      password: "correct horse",
      phone: "+380671234567",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await readUser(result.userId);
    expect(row?.acquisitionChannel).toBe("direct");
    expect(row?.phone).toBe("+380671234567");
  });

  it("rejects an email that is already registered", async () => {
    const { registerUser } = await import("./auth");
    const input = { fullName: "Dup", email: "dup@example.com", password: "correct horse" };
    await registerUser(testDb.db, input);

    expect(await registerUser(testDb.db, input)).toEqual({ ok: false, error: "email_taken" });
  });

  it("logs in with the right password and updates last_login_at each time", async () => {
    const { registerUser, verifyLogin } = await import("./auth");
    const registered = await registerUser(testDb.db, {
      fullName: "Login",
      email: "login@example.com",
      password: "correct horse",
    });
    if (!registered.ok) throw new Error("registration failed");
    const before = (await readUser(registered.userId))?.lastLoginAt;

    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await verifyLogin(testDb.db, "login@example.com", "correct horse");

    expect(result).toEqual({ ok: true, userId: registered.userId });
    const after = (await readUser(registered.userId))?.lastLoginAt;
    expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? Number.POSITIVE_INFINITY);
  });

  it("gives the same result for a wrong password and an unknown email", async () => {
    const { registerUser, verifyLogin } = await import("./auth");
    await registerUser(testDb.db, {
      fullName: "Wrong",
      email: "wrong@example.com",
      password: "correct horse",
    });

    expect(await verifyLogin(testDb.db, "wrong@example.com", "bad password")).toEqual({
      ok: false,
    });
    expect(await verifyLogin(testDb.db, "nobody@example.com", "bad password")).toEqual({
      ok: false,
    });
  });

  it("loads the session's user without the password hash", async () => {
    const { getUser, registerUser } = await import("./auth");
    const registered = await registerUser(testDb.db, {
      fullName: "Session",
      email: "session@example.com",
      password: "correct horse",
    });
    if (!registered.ok) throw new Error("registration failed");
    const request = (cookie: string) =>
      new Request("http://localhost/", { headers: { Cookie: cookie } });

    expect(await getUser(request(await cookieFor(registered.userId)), testDb.db)).toEqual({
      id: registered.userId,
      fullName: "Session",
      email: "session@example.com",
      role: "customer",
    });
    expect(await getUser(request(await cookieFor(999_999)), testDb.db)).toBeNull();
  });

  it("lets admins through and answers 403 to customers", async () => {
    const { registerUser, requireAdmin } = await import("./auth");
    const { setUserRole } = await import("../db/queries/users");
    const registered = await registerUser(testDb.db, {
      fullName: "Staff",
      email: "staff@example.com",
      password: "correct horse",
    });
    if (!registered.ok) throw new Error("registration failed");
    const request = new Request("http://localhost/admin", {
      headers: { Cookie: await cookieFor(registered.userId) },
    });

    // `data()` result; React Router turns it into the 403 the ErrorBoundary sees.
    expect(await requireAdmin(request, testDb.db).catch((error: unknown) => error)).toMatchObject({
      init: { status: 403 },
    });

    await setUserRole(testDb.db, "staff@example.com", "admin");
    expect(await requireAdmin(request, testDb.db)).toMatchObject({
      id: registered.userId,
      role: "admin",
    });

    // Demoting takes effect on the next request, with the same cookie.
    await setUserRole(testDb.db, "staff@example.com", "customer");
    expect(await requireAdmin(request, testDb.db).catch((error: unknown) => error)).toMatchObject({
      init: { status: 403 },
    });
  });

  it("redirects to login when the session's user no longer exists", async () => {
    const { requireAdmin } = await import("./auth");
    const request = new Request("http://localhost/admin", {
      headers: { Cookie: await cookieFor(999_999) },
    });

    const thrown = await requireAdmin(request, testDb.db).catch((error: unknown) => error);

    expect((thrown as Response).headers.get("Location")).toBe("/login?redirectTo=%2Fadmin");
  });
});
