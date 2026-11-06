import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const verification = vi.hoisted(() => ({
  inspectVerificationToken: vi.fn(),
  verifyEmail: vi.fn(),
}));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/email-verification", () => verification);

type ActionArgs = Parameters<typeof import("./verify-email").action>[0];
type LoaderArgs = Parameters<typeof import("./verify-email").loader>[0];

const TOKEN = "B".repeat(43);

function args<T>(token: string, method = "GET"): T {
  const request = new Request(`http://localhost/pidtverdzhennia/${token}`, { method });
  return { request, params: { token }, context: {} } as unknown as T;
}

function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(null);
});

describe("verify email loader", () => {
  it("checks the token without confirming anything", async () => {
    verification.inspectVerificationToken.mockResolvedValueOnce({ ok: true, userId: 5 });
    const { loader } = await import("./verify-email");

    expect(await loader(args<LoaderArgs>(TOKEN))).toEqual({
      loggedIn: false,
      tokenError: undefined,
    });
    expect(verification.verifyEmail).not.toHaveBeenCalled();
  });

  it("reports a bad token", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 5 });
    const { loader } = await import("./verify-email");
    expect(await loader(args<LoaderArgs>("nope"))).toEqual({
      loggedIn: true,
      tokenError: "unknown",
    });
  });
});

describe("verify email action", () => {
  it("confirms the email", async () => {
    verification.verifyEmail.mockResolvedValueOnce({ ok: true, userId: 5 });
    const { action } = await import("./verify-email");

    expect(unwrap(await action(args<ActionArgs>(TOKEN, "POST")))).toEqual({
      status: 200,
      body: { verified: true },
    });
    expect(verification.verifyEmail).toHaveBeenCalledWith(TOKEN);
  });

  it("answers a used or expired token with a typed error", async () => {
    verification.verifyEmail.mockResolvedValueOnce({ ok: false, error: "expired" });
    const { action } = await import("./verify-email");

    expect(unwrap(await action(args<ActionArgs>(TOKEN, "POST")))).toEqual({
      status: 400,
      body: { tokenError: "expired" },
    });
  });
});

describe("verify email page", () => {
  async function render(loaderData: unknown, actionData: unknown, locale: Locale = "uk") {
    const { default: VerifyEmail } = await import("./verify-email");
    const element = createElement(VerifyEmail as never, { loaderData, actionData });
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

  it("asks to confirm with a button", async () => {
    const html = await render({ loggedIn: false, tokenError: undefined }, undefined);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain("Підтвердити email");
    expect(await render({ loggedIn: false }, undefined, "en")).toContain("Confirm my email");
  });

  it("thanks the user after confirming, with the next step", async () => {
    const html = await render({ loggedIn: true, tokenError: "used" }, { verified: true }, "en");
    expect(html).toContain("Email confirmed");
    expect(html).toContain('href="/en/account"');
    expect(html).not.toContain("already been used");
  });

  it("explains an unusable link", async () => {
    const html = await render({ loggedIn: false, tokenError: "unknown" }, undefined);
    expect(html).toContain("Це посилання недійсне.");
    expect(html).toContain('href="/vkhid"');
  });
});
