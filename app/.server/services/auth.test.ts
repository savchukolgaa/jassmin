import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

const cart = vi.hoisted(() => ({ mergeGuestCart: vi.fn() }));
const analytics = vi.hoisted(() => ({
  readVisitor: vi.fn(),
  linkVisitorToUser: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("./cart", () => cart);
vi.mock("../analytics", async () => ({
  ...analytics,
  visitorContext: (await import("react-router")).createContext(null),
}));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || "postgres://u:p@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function cookieFor(userId: number, authenticatedAt?: Date): Promise<string> {
  const { commitSession, getSession } = await import("../session");
  const session = await getSession();
  session.set("userId", userId);
  if (authenticatedAt) session.set("authenticatedAt", authenticatedAt.getTime());
  return (await commitSession(session)).split(";")[0] ?? "";
}

describe("onUserAuthenticated", () => {
  const request = new Request("http://localhost/login", { method: "POST" });
  const ANONYMOUS_ID = "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11";
  const args = () => ({ request, context: new RouterContextProvider() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges the guest cart, links the visitor's analytics rows and records login", async () => {
    analytics.readVisitor.mockResolvedValueOnce({ anonymousId: ANONYMOUS_ID });
    const { onUserAuthenticated } = await import("./auth");
    const loginArgs = args();

    await onUserAuthenticated(loginArgs, 5, "login");

    expect(analytics.readVisitor).toHaveBeenCalledWith(request);
    expect(cart.mergeGuestCart).toHaveBeenCalledWith(5, ANONYMOUS_ID);
    expect(analytics.linkVisitorToUser).toHaveBeenCalledWith(ANONYMOUS_ID, 5);
    expect(analytics.trackEvent).toHaveBeenCalledWith(loginArgs, "login", {
      userId: 5,
      properties: { method: "login" },
    });
  });

  it("uses the visitor from the middleware and marks a registration", async () => {
    const { visitorContext } = await import("../analytics");
    const { onUserAuthenticated } = await import("./auth");
    const registerArgs = args();
    registerArgs.context.set(visitorContext, {
      anonymousId: ANONYMOUS_ID,
      sessionId: "s",
      attribution: { trafficSource: null, trafficMedium: null, trafficCampaign: null },
      headers: new Headers(),
    });

    await onUserAuthenticated(registerArgs, 9, "register");

    expect(analytics.readVisitor).not.toHaveBeenCalled();
    expect(analytics.linkVisitorToUser).toHaveBeenCalledWith(ANONYMOUS_ID, 9);
    expect(analytics.trackEvent).toHaveBeenCalledWith(registerArgs, "login", {
      userId: 9,
      properties: { method: "register" },
    });
  });

  it("skips everything for a visitor without a visitor cookie", async () => {
    analytics.readVisitor.mockResolvedValueOnce({});
    const { onUserAuthenticated } = await import("./auth");

    await onUserAuthenticated(args(), 5, "register");

    expect(cart.mergeGuestCart).not.toHaveBeenCalled();
    expect(analytics.linkVisitorToUser).not.toHaveBeenCalled();
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("never makes logging in fail, and one failure doesn't stop the rest", async () => {
    analytics.readVisitor.mockResolvedValueOnce({ anonymousId: ANONYMOUS_ID });
    cart.mergeGuestCart.mockRejectedValueOnce(new Error("db down"));
    analytics.linkVisitorToUser.mockRejectedValueOnce(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { onUserAuthenticated } = await import("./auth");

    await expect(onUserAuthenticated(args(), 5, "login")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(analytics.trackEvent).toHaveBeenCalled();
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
    expect(response.headers.get("Location")).toBe("/vkhid?redirectTo=%2Faccount%3Ftab%3Dorders");
  });

  it("returns to the page, not its data URL, after a client-side navigation (#112)", async () => {
    const { requireUser } = await import("./auth");

    const thrown = await requireUser(
      new Request("http://localhost/en/account.data?_routes=routes%2F_shop%2Caccount.en"),
    ).catch((error: unknown) => error);

    expect((thrown as Response).headers.get("Location")).toBe(
      "/en/login?redirectTo=%2Fen%2Faccount",
    );
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
      "/vkhid?redirectTo=%2Fadmin%2Forders%3Fx%3D1",
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
    // Nobody is opted in to marketing without ticking the box (#128).
    expect(row?.marketingOptIn).toBe(false);
  });

  it("stores a marketing consent given at registration (#128)", async () => {
    const { registerUser } = await import("./auth");

    const result = await registerUser(testDb.db, {
      fullName: "Iryna",
      email: "iryna@example.com",
      password: "correct horse",
      marketingOptIn: true,
    });

    if (!result.ok) throw new Error(result.error);
    expect((await readUser(result.userId))?.marketingOptIn).toBe(true);
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
      emailVerified: false,
    });
    expect(await getUser(request(await cookieFor(999_999)), testDb.db)).toBeNull();
  });

  it("rejects sessions that logged in before the password changed (#135)", async () => {
    const { getUser, registerUser } = await import("./auth");
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const registered = await registerUser(testDb.db, {
      fullName: "Revoked",
      email: "revoked@example.com",
      password: "correct horse",
    });
    if (!registered.ok) throw new Error("registration failed");
    const request = (cookie: string) =>
      new Request("http://localhost/", { headers: { Cookie: cookie } });
    const before = new Date("2026-11-05T10:00:00.123Z");
    const changedAt = new Date("2026-11-05T11:00:00.456Z");
    const legacyCookie = await cookieFor(registered.userId);
    const oldCookie = await cookieFor(registered.userId, before);

    // Without a password change, every cookie is valid, including one from before #135.
    expect(await getUser(request(legacyCookie), testDb.db)).not.toBeNull();
    expect(await getUser(request(oldCookie), testDb.db)).not.toBeNull();

    await testDb.db
      .update(users)
      .set({ passwordChangedAt: changedAt })
      .where(eq(users.id, registered.userId));

    expect(await getUser(request(legacyCookie), testDb.db)).toBeNull();
    expect(await getUser(request(oldCookie), testDb.db)).toBeNull();
    // The session issued at the change (the reset's own) survives, to the millisecond.
    expect(
      await getUser(request(await cookieFor(registered.userId, changedAt)), testDb.db),
    ).toMatchObject({ id: registered.userId });
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

    expect((thrown as Response).headers.get("Location")).toBe("/vkhid?redirectTo=%2Fadmin");
  });
});
