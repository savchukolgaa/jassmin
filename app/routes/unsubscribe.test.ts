import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";

const marketing = vi.hoisted(() => ({
  inspectUnsubscribeToken: vi.fn(),
  unsubscribeMarketing: vi.fn(),
}));
const env = vi.hoisted(() => ({
  getEnv: vi.fn(() => ({ EMAIL_UNSUBSCRIBE_SECRET: "s".repeat(32) })),
}));

vi.mock("~/.server/services/marketing", () => marketing);
vi.mock("~/.server/env", () => env);
vi.mock("~/.server/db", () => ({ db: {} }));

type ActionArgs = Parameters<typeof import("./unsubscribe").action>[0];
type LoaderArgs = Parameters<typeof import("./unsubscribe").loader>[0];

const TOKEN = `12.${"B".repeat(43)}`;

function args<T>(token: string, init?: RequestInit): T {
  const request = new Request(`http://localhost/vidpysatysia/${token}`, init);
  return { request, params: { token }, context: {} } as unknown as T;
}

/** The RFC 8058 one-click POST a mail client sends, without cookies. */
const oneClick: RequestInit = {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "List-Unsubscribe=One-Click",
};

function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unsubscribe loader", () => {
  it("checks the token without unsubscribing", async () => {
    marketing.inspectUnsubscribeToken.mockReturnValueOnce(12);
    const { loader } = await import("./unsubscribe");

    expect(loader(args<LoaderArgs>(TOKEN))).toEqual({ valid: true });
    expect(marketing.unsubscribeMarketing).not.toHaveBeenCalled();
  });

  it("reports a malformed or forged token", async () => {
    const { loader } = await import("./unsubscribe");
    expect(loader(args<LoaderArgs>("nope"))).toEqual({ valid: false });
    expect(marketing.inspectUnsubscribeToken).not.toHaveBeenCalled();

    marketing.inspectUnsubscribeToken.mockReturnValueOnce(undefined);
    expect(loader(args<LoaderArgs>(TOKEN))).toEqual({ valid: false });
  });
});

describe("unsubscribe action", () => {
  it("unsubscribes from the page's button", async () => {
    marketing.unsubscribeMarketing.mockResolvedValueOnce({ ok: true });
    const { action } = await import("./unsubscribe");

    expect(unwrap(await action(args<ActionArgs>(TOKEN, { method: "POST" })))).toEqual({
      status: 200,
      body: { unsubscribed: true },
    });
    expect(marketing.unsubscribeMarketing).toHaveBeenCalledWith(TOKEN, expect.anything());
  });

  it("answers a mail client's one-click POST with a 200", async () => {
    marketing.unsubscribeMarketing.mockResolvedValue({ ok: true });
    const { action } = await import("./unsubscribe");

    expect(unwrap(await action(args<ActionArgs>(TOKEN, oneClick)))).toEqual({
      status: 200,
      body: { unsubscribed: true },
    });
    // Again is still fine.
    expect(unwrap(await action(args<ActionArgs>(TOKEN, oneClick))).status).toBe(200);
  });

  it("refuses a bad token and an unexpected body without unsubscribing", async () => {
    const { action } = await import("./unsubscribe");

    expect(unwrap(await action(args<ActionArgs>("nope", oneClick)))).toEqual({
      status: 400,
      body: { error: "invalid-token" },
    });
    expect(
      unwrap(
        await action(
          args<ActionArgs>(TOKEN, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=Something",
          }),
        ),
      ),
    ).toEqual({ status: 400, body: { error: "invalid" } });
    expect(marketing.unsubscribeMarketing).not.toHaveBeenCalled();

    marketing.unsubscribeMarketing.mockResolvedValueOnce({ ok: false, error: "invalid-token" });
    expect(unwrap(await action(args<ActionArgs>(TOKEN, oneClick)))).toEqual({
      status: 400,
      body: { error: "invalid-token" },
    });
  });

  it("keeps the token out of caches and Referer", async () => {
    const { headers } = await import("./unsubscribe");
    expect(headers()).toEqual({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    });
  });
});

describe("unsubscribe page", () => {
  async function render(loaderData: unknown, actionData: unknown, locale: Locale = "uk") {
    const { default: Unsubscribe } = await import("./unsubscribe");
    const element = createElement(Unsubscribe as never, { loaderData, actionData });
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
    const html = await render({ valid: true }, undefined);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain("Відписатися");
    expect(await render({ valid: true }, undefined, "en")).toContain(
      "Unsubscribe from news and offers?",
    );
  });

  it("confirms the unsubscribe", async () => {
    const html = await render({ valid: true }, { unsubscribed: true }, "en");
    expect(html).toContain("You&#x27;ve unsubscribed");
    expect(html).not.toContain("<form");
  });

  it("explains an unusable link and points to the profile", async () => {
    const html = await render({ valid: false }, undefined);
    expect(html).toContain("Це посилання не працює.");
    expect(html).toContain('href="/kabinet/profil"');
    expect(html).not.toContain("<form");
  });
});
