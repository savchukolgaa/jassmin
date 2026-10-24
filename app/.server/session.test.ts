import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://jassmin:jassmin@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/** The `name=value` part of a `Set-Cookie` header, to send back as `Cookie`. */
function cookieFrom(response: Response): string {
  return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

describe("session helpers", () => {
  it("has no user without a cookie", async () => {
    const { getUserId } = await import("./session");

    expect(await getUserId(new Request("http://localhost/"))).toBeUndefined();
  });

  it("logs a user in with an httpOnly cookie and redirects", async () => {
    const { createUserSession, getUserId } = await import("./session");

    const response = await createUserSession({
      request: new Request("http://localhost/login", { method: "POST" }),
      userId: 42,
      redirectTo: "/account",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/account");
    expect(response.headers.get("Set-Cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("Set-Cookie")).toMatch(/SameSite=Lax/i);
    expect(
      await getUserId(
        new Request("http://localhost/", { headers: { Cookie: cookieFrom(response) } }),
      ),
    ).toBe(42);
  });

  it("logs out by clearing the cookie and redirecting home", async () => {
    const { createUserSession, logout } = await import("./session");
    const login = await createUserSession({
      request: new Request("http://localhost/login", { method: "POST" }),
      userId: 42,
      redirectTo: "/account",
    });

    const response = await logout(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { Cookie: cookieFrom(login) },
      }),
    );

    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("remembers the last ten orders placed in this browser, newest first", async () => {
    const { getSessionOrderIds, rememberOrder } = await import("./session");
    let cookie = "";
    const request = () => new Request("http://localhost/checkout", { headers: { Cookie: cookie } });

    expect(await getSessionOrderIds(request())).toEqual([]);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 5]) {
      cookie = (await rememberOrder(request(), id)).split(";")[0] ?? "";
    }

    expect(await getSessionOrderIds(request())).toEqual([5, 11, 10, 9, 8, 7, 6, 4, 3, 2]);
  });
});
