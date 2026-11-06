import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";

const auth = vi.hoisted(() => ({ onUserAuthenticated: vi.fn() }));
const reset = vi.hoisted(() => ({ inspectResetToken: vi.fn(), resetPassword: vi.fn() }));
const users = vi.hoisted(() => ({ touchLastLogin: vi.fn() }));
const session = vi.hoisted(() => ({
  createUserSession: vi.fn(
    async ({ userId, redirectTo }: { userId: number; redirectTo: string }) =>
      new Response(null, {
        status: 302,
        headers: { Location: redirectTo, "Set-Cookie": `uid=${userId}` },
      }),
  ),
}));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/password-reset", () => reset);
vi.mock("~/.server/db", () => ({ db: {} }));
vi.mock("~/.server/db/queries/users", () => users);
vi.mock("~/.server/session", () => session);

type ActionArgs = Parameters<typeof import("./reset-password").action>[0];
type LoaderArgs = Parameters<typeof import("./reset-password").loader>[0];

const TOKEN = "A".repeat(43);

function post(fields: Record<string, string>, token = TOKEN, path = "/novyi-parol"): ActionArgs {
  const request = new Request(`http://localhost${path}/${token}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: { token }, context: {} } as unknown as ActionArgs;
}

function unwrap(result: unknown): { status: number; body: unknown } {
  if (result instanceof Response) return { status: result.status, body: null };
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reset password loader", () => {
  const load = async (token: string) => {
    const { loader } = await import("./reset-password");
    return loader({
      request: new Request(`http://localhost/novyi-parol/${token}`),
      params: { token },
      context: {},
    } as unknown as LoaderArgs);
  };

  it("checks the token without using it", async () => {
    reset.inspectResetToken.mockResolvedValueOnce({ ok: true, userId: 5 });
    expect(await load(TOKEN)).toEqual({ tokenError: undefined });
    expect(reset.inspectResetToken).toHaveBeenCalledWith(TOKEN);
    expect(reset.resetPassword).not.toHaveBeenCalled();
  });

  it("reports an expired, used or malformed token", async () => {
    reset.inspectResetToken.mockResolvedValueOnce({ ok: false, error: "expired" });
    expect(await load(TOKEN)).toEqual({ tokenError: "expired" });
    expect(await load("short")).toEqual({ tokenError: "unknown" });
  });
});

describe("reset password action", () => {
  const valid = { password: "new password", confirmPassword: "new password" };

  it("sets the password, logs in and keeps the new session past the revocation", async () => {
    const changedAt = new Date("2026-11-05T12:30:00Z");
    reset.resetPassword.mockResolvedValueOnce({
      ok: true,
      userId: 5,
      email: "olena@example.com",
      changedAt,
    });
    const { action } = await import("./reset-password");

    const result = await action(post(valid, TOKEN, "/en/reset-password"));

    expect(reset.resetPassword).toHaveBeenCalledWith({ token: TOKEN, password: "new password" });
    expect(users.touchLastLogin).toHaveBeenCalledWith({}, 5);
    expect(auth.onUserAuthenticated).toHaveBeenCalledWith(
      { request: expect.any(Request), context: {} },
      5,
      "password_reset",
    );
    expect(session.createUserSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 5, redirectTo: "/en/account", authenticatedAt: changedAt }),
    );
    expect((result as Response).headers.get("Set-Cookie")).toBe("uid=5");
  });

  it("validates the new password before using the token", async () => {
    const { action } = await import("./reset-password");
    expect(
      unwrap(await action(post({ password: "new password", confirmPassword: "other" }))),
    ).toEqual({
      status: 400,
      body: { fieldErrors: { confirmPassword: "auth.errors.passwordMismatch" } },
    });
    expect(unwrap(await action(post({ password: "short", confirmPassword: "short" })))).toEqual({
      status: 400,
      body: { fieldErrors: { password: "auth.errors.passwordTooShort" } },
    });
    expect(reset.resetPassword).not.toHaveBeenCalled();
  });

  it("answers a used, expired or malformed token with a typed error", async () => {
    reset.resetPassword.mockResolvedValueOnce({ ok: false, error: "used" });
    const { action } = await import("./reset-password");

    expect(unwrap(await action(post(valid)))).toEqual({
      status: 400,
      body: { tokenError: "used" },
    });
    expect(unwrap(await action(post(valid, "bad")))).toEqual({
      status: 400,
      body: { tokenError: "unknown" },
    });
    expect(session.createUserSession).not.toHaveBeenCalled();
  });

  it("keeps the token out of Referer headers and caches", async () => {
    const { headers } = await import("./reset-password");
    expect(headers()).toEqual({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    });
  });
});

describe("reset password page", () => {
  async function render(loaderData: unknown, actionData: unknown, locale: Locale = "uk") {
    const { default: ResetPassword } = await import("./reset-password");
    const element = createElement(ResetPassword as never, { loaderData, actionData });
    return renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale },
        createElement(RouterProvider, {
          router: createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] }),
        }),
      ),
    );
  }

  it("shows the new password form for a valid link", async () => {
    const html = await render({ tokenError: undefined }, undefined);
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain("Зберегти пароль");
    expect(await render({ tokenError: undefined }, undefined, "en")).toContain("Save the password");
  });

  it("offers a new link for an expired one", async () => {
    const html = await render({ tokenError: "expired" }, undefined, "en");
    expect(html).toContain("This link has expired.");
    expect(html).toContain('href="/en/forgot-password"');
    expect(html).not.toContain("<form");
  });

  it("shows the action's token error over the loader's", async () => {
    const html = await render({ tokenError: undefined }, { tokenError: "used" });
    expect(html).toContain("Це посилання вже використано.");
  });
});
