import { beforeEach, describe, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({ getProductFeed: vi.fn() }));
vi.mock("~/.server/services/product-feed", () => feed);

const env = vi.hoisted(() => ({ PUBLIC_SITE_URL: "https://jassmin.ua" as string | undefined }));
vi.mock("~/.server/env", () => ({
  getEnv: () => env,
  getSiteUrl: (e: typeof env, request: Request) => e.PUBLIC_SITE_URL ?? new URL(request.url).origin,
}));

const { feedLocale, loader } = await import("./feeds.products.xml");

type LoaderArgs = Parameters<typeof loader>[0];

const load = (path: string) =>
  loader({ request: new Request(`http://localhost:3000${path}`) } as LoaderArgs);

beforeEach(() => {
  feed.getProductFeed.mockReset();
  env.PUBLIC_SITE_URL = "https://jassmin.ua";
});

describe("feeds/products.xml loader", () => {
  it("streams the Ukrainian feed as XML, cached for an hour and not indexed", async () => {
    feed.getProductFeed.mockResolvedValue(["<rss>", "<item>Квіти &amp; мускус</item>", "</rss>"]);

    const response = await load("/feeds/products.xml");

    expect(feed.getProductFeed).toHaveBeenCalledWith({
      locale: "uk",
      siteUrl: "https://jassmin.ua",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.text()).toBe("<rss><item>Квіти &amp; мускус</item></rss>");
  });

  it("serves the English feed under /en", async () => {
    feed.getProductFeed.mockResolvedValue(["<rss/>"]);

    await load("/en/feeds/products.xml");

    expect(feed.getProductFeed).toHaveBeenCalledWith({
      locale: "en",
      siteUrl: "https://jassmin.ua",
    });
  });

  it("throws a database error instead of sending a broken feed", async () => {
    feed.getProductFeed.mockRejectedValue(new Error("connection refused"));

    await expect(load("/feeds/products.xml")).rejects.toThrow("connection refused");
  });
});

describe("feedLocale", () => {
  it("is English only under /en/", () => {
    expect(feedLocale(new Request("https://jassmin.ua/feeds/products.xml"))).toBe("uk");
    expect(feedLocale(new Request("https://jassmin.ua/en/feeds/products.xml"))).toBe("en");
  });
});
