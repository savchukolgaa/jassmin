import { beforeEach, describe, expect, it, vi } from "vitest";

const sitemap = vi.hoisted(() => ({ getSitemap: vi.fn() }));
vi.mock("~/.server/services/sitemap", () => sitemap);

const env = vi.hoisted(() => ({ PUBLIC_SITE_URL: "https://jassmin.ua" as string | undefined }));
vi.mock("~/.server/env", () => ({
  getEnv: () => env,
  getSiteUrl: (e: typeof env, request: Request) => e.PUBLIC_SITE_URL ?? new URL(request.url).origin,
}));

const { loader } = await import("./sitemap.xml");

type LoaderArgs = Parameters<typeof loader>[0];

const load = () =>
  loader({ request: new Request("http://localhost:3000/sitemap.xml") } as LoaderArgs);

beforeEach(() => {
  sitemap.getSitemap.mockReset();
  env.PUBLIC_SITE_URL = "https://jassmin.ua";
});

describe("sitemap.xml loader", () => {
  it("serves the XML for the public site URL, cached for an hour", async () => {
    sitemap.getSitemap.mockResolvedValue({ xml: "<urlset/>", complete: true });

    const response = await load();

    expect(sitemap.getSitemap).toHaveBeenCalledWith("https://jassmin.ua");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe("<urlset/>");
  });

  it("falls back to the request's origin without PUBLIC_SITE_URL", async () => {
    env.PUBLIC_SITE_URL = undefined;
    sitemap.getSitemap.mockResolvedValue({ xml: "<urlset/>", complete: true });

    await load();

    expect(sitemap.getSitemap).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("caches a sitemap without the blog posts for 5 minutes only", async () => {
    sitemap.getSitemap.mockResolvedValue({ xml: "<urlset/>", complete: false });

    const response = await load();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});
