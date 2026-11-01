import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyLogin: vi.fn(),
  onUserAuthenticated: vi.fn(),
}));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/db", () => ({ db: {} }));
vi.mock("~/.server/session", () => ({
  createUserSession: vi.fn(
    async ({ userId, redirectTo }: { userId: number; redirectTo: string }) =>
      new Response(null, {
        status: 302,
        headers: { Location: redirectTo, "Set-Cookie": `uid=${userId}` },
      }),
  ),
}));

type ActionArgs = Parameters<typeof import("./login").action>[0];

function post(fields: Record<string, string>, headers: Record<string, string> = {}): ActionArgs {
  const request = new Request("http://localhost/login", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers,
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload and status; plain Responses pass through. */
function unwrap(result: unknown): { status: number; body: unknown } {
  if (result instanceof Response) return { status: result.status, body: null };
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { loginLimiters } = await import("~/.server/rate-limit");
  for (const email of ["olena@example.com", "blocked@example.com"]) {
    loginLimiters.byEmail.reset(email);
  }
  loginLimiters.byIp.reset("203.0.113.9");
});

describe("login action", () => {
  it("logs in and redirects to a safe redirectTo", async () => {
    auth.verifyLogin.mockResolvedValueOnce({ ok: true, userId: 5 });
    const { action } = await import("./login");

    const result = await action(
      post({ email: " Olena@Example.com ", password: "secret", redirectTo: "/products/1" }),
    );

    expect(auth.verifyLogin).toHaveBeenCalledWith({}, "olena@example.com", "secret");
    expect(auth.onUserAuthenticated).toHaveBeenCalledWith(
      { request: expect.any(Request), context: {} },
      5,
      "login",
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/products/1");
  });

  it("ignores an external redirectTo", async () => {
    auth.verifyLogin.mockResolvedValueOnce({ ok: true, userId: 5 });
    const { action } = await import("./login");

    const result = await action(
      post({ email: "olena@example.com", password: "secret", redirectTo: "//evil.com" }),
    );

    expect((result as Response).headers.get("Location")).toBe("/kabinet");
  });

  it("returns a generic error without the password on bad credentials", async () => {
    auth.verifyLogin.mockResolvedValueOnce({ ok: false });
    const { action } = await import("./login");

    const { status, body } = unwrap(
      await action(post({ email: "olena@example.com", password: "wrong" })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      formError: "auth.errors.invalidCredentials",
      values: { email: "olena@example.com" },
    });
    expect(JSON.stringify(body)).not.toContain("wrong");
  });

  it("returns field errors for invalid input without checking credentials", async () => {
    const { action } = await import("./login");

    const { status, body } = unwrap(await action(post({ email: "nope", password: "" })));

    expect(status).toBe(400);
    expect(body).toMatchObject({
      fieldErrors: { email: "auth.errors.emailInvalid", password: "auth.errors.passwordRequired" },
    });
    expect(auth.verifyLogin).not.toHaveBeenCalled();
  });

  it("blocks an email after 5 failed attempts", async () => {
    auth.verifyLogin.mockResolvedValue({ ok: false });
    const { action } = await import("./login");
    for (let i = 0; i < 5; i++) {
      await action(post({ email: "blocked@example.com", password: "wrong" }));
    }

    const { status, body } = unwrap(
      await action(post({ email: "blocked@example.com", password: "right" })),
    );

    expect(status).toBe(429);
    expect(body).toMatchObject({ formError: "auth.errors.tooManyAttempts" });
    expect(auth.verifyLogin).toHaveBeenCalledTimes(5);
  });

  it("blocks an IP after 20 failed attempts", async () => {
    auth.verifyLogin.mockResolvedValue({ ok: false });
    const { action } = await import("./login");
    const headers = { "X-Forwarded-For": "203.0.113.9" };
    for (let i = 0; i < 20; i++) {
      await action(post({ email: `user${i}@example.com`, password: "wrong" }, headers));
    }

    const { status } = unwrap(
      await action(post({ email: "olena@example.com", password: "right" }, headers)),
    );

    expect(status).toBe(429);
  });
});

describe("login loader", () => {
  it("redirects a logged-in user away", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 5, fullName: "Olena", email: "o@example.com" });
    const { loader } = await import("./login");
    type LoaderArgs = Parameters<typeof loader>[0];
    const args = {
      request: new Request("http://localhost/login?redirectTo=%2Fcart"),
      params: {},
      context: {},
    } as unknown as LoaderArgs;

    const thrown = await loader(args).catch((error: unknown) => error);

    expect((thrown as Response).headers.get("Location")).toBe("/cart");
  });
});
