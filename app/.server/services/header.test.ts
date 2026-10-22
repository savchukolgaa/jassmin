import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://jassmin:jassmin@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("getHeaderState", () => {
  it("is logged out with an empty cart without a session cookie", async () => {
    const { getHeaderState } = await import("./header");

    expect(await getHeaderState(new Request("http://localhost/"))).toEqual({
      user: null,
      cartCount: 0,
    });
  });

  it("returns the user from the session cookie", async () => {
    const { commitSession, getSession } = await import("../session");
    const { getHeaderState } = await import("./header");
    const session = await getSession();
    session.set("userId", 7);
    const cookie = (await commitSession(session)).split(";")[0] ?? "";

    const state = await getHeaderState(
      new Request("http://localhost/", { headers: { Cookie: cookie } }),
    );

    expect(state.user).toEqual({ id: 7 });
  });
});
