import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  registerUser: vi.fn(),
  onUserAuthenticated: vi.fn(),
}));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/db", () => ({ db: {} }));
vi.mock("~/.server/session", () => ({
  createUserSession: vi.fn(
    async ({ redirectTo }: { redirectTo: string }) =>
      new Response(null, { status: 302, headers: { Location: redirectTo } }),
  ),
}));

type ActionArgs = Parameters<typeof import("./register").action>[0];
type LoaderArgs = Parameters<typeof import("./register").loader>[0];

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/register", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

function get(url: string, headers: Record<string, string> = {}): LoaderArgs {
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {},
  } as unknown as LoaderArgs;
}

function unwrap(result: unknown): { status: number; body: unknown } {
  if (result instanceof Response) return { status: result.status, body: null };
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

const valid = {
  fullName: "Olena Petrenko",
  email: "Olena@Example.com",
  password: "correct horse",
  phone: "",
  acquisitionChannel: "instagram",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("register action", () => {
  it("registers, logs in and redirects to /account", async () => {
    auth.registerUser.mockResolvedValueOnce({ ok: true, userId: 9 });
    const { action } = await import("./register");

    const result = await action(post(valid));

    expect(auth.registerUser).toHaveBeenCalledWith(
      {},
      {
        fullName: "Olena Petrenko",
        email: "olena@example.com",
        password: "correct horse",
        phone: undefined,
        acquisitionChannel: "instagram",
      },
    );
    expect(auth.onUserAuthenticated).toHaveBeenCalledWith(
      { request: expect.any(Request), context: {} },
      9,
      "register",
    );
    expect((result as Response).headers.get("Location")).toBe("/kabinet");
  });

  it("reports a taken email and refills the form without the password", async () => {
    auth.registerUser.mockResolvedValueOnce({ ok: false, error: "email_taken" });
    const { action } = await import("./register");

    const { status, body } = unwrap(await action(post(valid)));

    expect(status).toBe(400);
    expect(body).toEqual({
      fieldErrors: { email: "auth.errors.emailTaken" },
      values: { fullName: "Olena Petrenko", email: "Olena@Example.com", phone: "" },
    });
    expect(JSON.stringify(body)).not.toContain("correct horse");
  });

  it("returns field errors for invalid input", async () => {
    const { action } = await import("./register");

    const { status, body } = unwrap(
      await action(post({ ...valid, fullName: "", password: "short" })),
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      fieldErrors: {
        fullName: "auth.errors.nameRequired",
        password: "auth.errors.passwordTooShort",
      },
    });
    expect(auth.registerUser).not.toHaveBeenCalled();
  });
});

describe("register loader", () => {
  it("works out the acquisition channel from UTM or referrer", async () => {
    auth.getUser.mockResolvedValue(null);
    const { loader } = await import("./register");

    expect(await loader(get("http://localhost/register?utm_source=Facebook"))).toEqual({
      redirectTo: undefined,
      acquisitionChannel: "facebook",
    });
    expect(
      await loader(get("http://localhost/register", { Referer: "https://www.google.com/" })),
    ).toMatchObject({ acquisitionChannel: "google.com" });
    expect(await loader(get("http://localhost/register"))).toMatchObject({
      acquisitionChannel: "direct",
    });
  });

  it("redirects a logged-in user away", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 9, fullName: "Olena", email: "o@example.com" });
    const { loader } = await import("./register");

    const thrown = await loader(get("http://localhost/register")).catch((error: unknown) => error);

    expect((thrown as Response).headers.get("Location")).toBe("/kabinet");
  });
});
