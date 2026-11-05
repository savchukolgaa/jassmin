import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const reset = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/password-reset", () => reset);
vi.mock("~/.server/env", () => ({
  getEnv: () => ({}),
  getSiteUrl: () => "https://jassmin.ua",
}));

type ActionArgs = Parameters<typeof import("./forgot-password").action>[0];
type LoaderArgs = Parameters<typeof import("./forgot-password").loader>[0];

const IP = "203.0.113.20";

function post(fields: Record<string, string>, path = "/zabuly-parol"): ActionArgs {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "X-Forwarded-For": IP },
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

function unwrap(result: unknown): { status: number; body: unknown } {
  if (result instanceof Response) return { status: result.status, body: null };
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { passwordResetLimiters } = await import("~/.server/rate-limit");
  for (const email of ["olena@example.com", "nobody@example.com", "a@example.com"]) {
    passwordResetLimiters.byEmail.reset(email);
  }
  passwordResetLimiters.byIp.reset(IP);
});

describe("forgot password action", () => {
  it("gives the same answer for a registered and an unknown email", async () => {
    const { action } = await import("./forgot-password");

    const known = unwrap(await action(post({ email: " Olena@Example.com " })));
    const unknown = unwrap(await action(post({ email: "nobody@example.com" })));

    expect(known).toEqual({ status: 200, body: { sent: true } });
    expect(unknown).toEqual(known);
    expect(reset.requestPasswordReset).toHaveBeenCalledWith({
      email: "olena@example.com",
      locale: "uk",
      siteUrl: "https://jassmin.ua",
    });
  });

  it("asks in the page's language", async () => {
    const { action } = await import("./forgot-password");
    await action(post({ email: "olena@example.com" }, "/en/forgot-password"));
    expect(reset.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" }),
    );
  });

  it("validates the email", async () => {
    const { action } = await import("./forgot-password");
    expect(unwrap(await action(post({ email: "nope" })))).toEqual({
      status: 400,
      body: { fieldErrors: { email: "auth.errors.emailInvalid" }, values: { email: "nope" } },
    });
    expect(reset.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("allows 3 requests per email per hour", async () => {
    const { action } = await import("./forgot-password");
    for (let i = 0; i < 3; i++) {
      expect(unwrap(await action(post({ email: "a@example.com" }))).status).toBe(200);
    }
    expect(unwrap(await action(post({ email: "a@example.com" })))).toEqual({
      status: 429,
      body: { formError: "auth.errors.tooManyRequests", values: { email: "a@example.com" } },
    });
    expect(reset.requestPasswordReset).toHaveBeenCalledTimes(3);
  });

  it("allows 10 requests per IP per hour", async () => {
    const { action } = await import("./forgot-password");
    const { passwordResetLimiters } = await import("~/.server/rate-limit");
    for (let i = 0; i < 10; i++) {
      const email = `ip${i}@example.com`;
      passwordResetLimiters.byEmail.reset(email);
      expect(unwrap(await action(post({ email }))).status).toBe(200);
    }
    expect(unwrap(await action(post({ email: "olena@example.com" }))).status).toBe(429);
  });
});

describe("forgot password loader", () => {
  it("sends a logged-in user to the account", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 1 });
    const { loader } = await import("./forgot-password");
    const request = new Request("http://localhost/en/forgot-password");
    const thrown = await loader({
      request,
      params: {},
      context: {},
    } as unknown as LoaderArgs).catch((error: unknown) => error);
    expect((thrown as Response).headers.get("Location")).toBe("/en/account");
  });
});

describe("forgot password page", () => {
  async function render(actionData: unknown, locale: Locale = "uk") {
    const { default: ForgotPassword } = await import("./forgot-password");
    const element = createElement(ForgotPassword as never, { loaderData: null, actionData });
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

  it("shows the form, then the same notice for every email", async () => {
    expect(await render(undefined)).toContain("Надіслати посилання");
    expect(await render({ sent: true })).toContain("Якщо цей email зареєстровано");
    expect(await render({ sent: true }, "en")).toContain("If this email is registered");
  });

  it("shows the rate limit error", async () => {
    const html = await render({ formError: "auth.errors.tooManyRequests" }, "en");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Too many requests");
  });
});
