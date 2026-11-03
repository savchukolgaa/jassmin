import { describe, expect, it, vi } from "vitest";
import { localeCookie } from "~/.server/locale";

const content = vi.hoisted(() => ({ getBlogPostBySlug: vi.fn(async () => null) }));
vi.mock("~/.server/cms/content", () => content);

const { action, loader } = await import("./locale");

type ActionArgs = Parameters<typeof action>[0];

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/locale", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload and status. */
function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

describe("locale action", () => {
  it("stores the locale in a cookie and goes to the same page in that language (#84)", async () => {
    const response = await action(
      post({ locale: "en", redirectTo: "/katalog/cholovichi?sort=newest#grid" }),
    );

    expect(response).toBeInstanceOf(Response);
    const { status, headers } = response as Response;
    expect(status).toBe(302);
    expect(headers.get("Location")).toBe("/en/catalog/men?sort=newest#grid");
    const setCookie = headers.get("Set-Cookie") ?? "";
    expect(setCookie).toMatch(/^locale=/);
    expect(setCookie).toMatch(/Max-Age=31536000/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(await localeCookie.parse(setCookie.split(";")[0] ?? "")).toBe("en");
  });

  it("goes back to Ukrainian, and to the blog list for an untranslated post", async () => {
    const back = (await action(
      post({ locale: "uk", redirectTo: "/en/account/profile" }),
    )) as Response;
    expect(back.headers.get("Location")).toBe("/kabinet/profil");
    const post_ = (await action(
      post({ locale: "en", redirectTo: "/blog/tilky-ukrainskoiu" }),
    )) as Response;
    expect(post_.headers.get("Location")).toBe("/en/blog");
  });

  it("goes to the same page in the other language on every page, both ways (#112)", async () => {
    const pairs = [
      ["/", "/en"],
      ["/katalog/zhinochi?sort=newest#grid", "/en/catalog/women?sort=newest#grid"],
      ["/katalog/cholovichi", "/en/catalog/men"],
      ["/parfumy/dior-sauvage", "/en/perfumes/dior-sauvage"],
      ["/populiarni?family=floral", "/en/popular?family=floral"],
      ["/koshyk", "/en/cart"],
      ["/kabinet", "/en/account"],
      ["/kabinet/zamovlennia/42", "/en/account/orders/42"],
      ["/blog", "/en/blog"],
    ] as const;
    for (const [uk, en] of pairs) {
      const toEnglish = (await action(post({ locale: "en", redirectTo: uk }))) as Response;
      expect(toEnglish.headers.get("Location"), uk).toBe(en);
      expect(await localeCookie.parse(toEnglish.headers.get("Set-Cookie"))).toBe("en");

      const toUkrainian = (await action(post({ locale: "uk", redirectTo: en }))) as Response;
      expect(toUkrainian.headers.get("Location"), en).toBe(uk);
      expect(await localeCookie.parse(toUkrainian.headers.get("Set-Cookie"))).toBe("uk");
    }
  });

  it("redirects home instead of to another site", async () => {
    const response = (await action(post({ locale: "uk", redirectTo: "//evil.com" }))) as Response;
    expect(response.headers.get("Location")).toBe("/");
    const missing = (await action(post({ locale: "uk" }))) as Response;
    expect(missing.headers.get("Location")).toBe("/");
  });

  it("rejects an unsupported locale without setting a cookie", async () => {
    const result = await action(post({ locale: "de", redirectTo: "/" }));
    expect(result).not.toBeInstanceOf(Response);
    expect(unwrap(result)).toEqual({ status: 400, body: { ok: false, error: "invalid-locale" } });
  });
});

describe("locale loader", () => {
  it("redirects a GET home", () => {
    const response = loader();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});
