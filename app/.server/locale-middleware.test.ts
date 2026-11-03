import type { MiddlewareFunction } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { localeCookie } from "./locale";

vi.mock("./cms/content", () => ({ getBlogPostBySlug: vi.fn(async () => null) }));

const { localeRedirectMiddleware } = await import("./locale-middleware");

type Args = Parameters<MiddlewareFunction<Response>>[0];

async function run(
  path: string,
  {
    cookie,
    method = "GET",
    acceptLanguage,
  }: {
    cookie?: string;
    method?: string;
    acceptLanguage?: string;
  } = {},
) {
  const headers = new Headers();
  if (cookie) {
    headers.set("Cookie", (await localeCookie.serialize(cookie)).split(";")[0] ?? "");
  }
  if (acceptLanguage) {
    headers.set("Accept-Language", acceptLanguage);
  }
  const request = new Request(`http://localhost${path}`, { method, headers });
  const next = vi.fn(async () => new Response("page"));
  const result = await (
    localeRedirectMiddleware({ request } as Args, next) as Promise<Response>
  ).catch((thrown: unknown) => thrown);
  return { result: result as Response, next };
}

describe("localeRedirectMiddleware", () => {
  it("sends a visitor who chose English from a Ukrainian page to its English URL (302)", async () => {
    const { result, next } = await run("/katalog/zhinochi?page=2", { cookie: "en" });

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/en/catalog/women?page=2");
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects a client-side navigation's data request too (#112)", async () => {
    const { result, next } = await run("/koshyk.data?_routes=routes%2F_shop%2Ccart.uk", {
      cookie: "en",
    });

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/en/cart");
    expect(next).not.toHaveBeenCalled();

    const english = await run("/en.data", { cookie: "en" });
    expect(english.next).toHaveBeenCalledOnce();
  });

  it("never redirects without the cookie, even when the browser prefers English", async () => {
    const { result, next } = await run("/koshyk", { acceptLanguage: "en-US,en" });

    expect(await result.text()).toBe("page");
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves English pages, Ukrainian choices, POSTs and non-pages alone", async () => {
    for (const [path, options] of [
      ["/en/cart", { cookie: "en" }],
      ["/koshyk", { cookie: "uk" }],
      ["/koshyk", { cookie: "en", method: "POST" }],
      ["/logout", { cookie: "en", method: "POST" }],
      ["/catalog/women", { cookie: "en" }],
    ] as const) {
      const { next } = await run(path, options);
      expect(next, `${path} ${JSON.stringify(options)}`).toHaveBeenCalledOnce();
    }
  });
});
