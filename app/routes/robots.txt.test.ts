import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  NODE_ENV: "production" as "development" | "production" | "test",
  ROBOTS_DISALLOW_ALL: undefined as boolean | undefined,
  PUBLIC_SITE_URL: "https://jassmin.ua",
}));
vi.mock("~/.server/env", () => ({
  getEnv: () => env,
  getSiteUrl: (e: typeof env) => e.PUBLIC_SITE_URL,
}));

const { loader } = await import("./robots.txt");

type LoaderArgs = Parameters<typeof loader>[0];

async function load() {
  const response = loader({
    request: new Request("https://jassmin.ua/robots.txt"),
  } as LoaderArgs);
  return { response, body: await response.text() };
}

const disallowed = (body: string) => body.match(/^Disallow: (.*)$/gm) ?? [];

beforeEach(() => {
  env.NODE_ENV = "production";
  env.ROBOTS_DISALLOW_ALL = undefined;
});

describe("robots.txt loader", () => {
  it("blocks private and action-only paths in production and links the sitemap", async () => {
    const { response, body } = await load();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(body).toMatch(/^User-agent: \*$/m);
    expect(disallowed(body)).toEqual(
      expect.arrayContaining(["Disallow: /koshyk", "Disallow: /en/cart", "Disallow: /api/"]),
    );
    expect(disallowed(body)).not.toContain("Disallow: /");
    expect(body).toContain("Sitemap: https://jassmin.ua/sitemap.xml");
  });

  it.each(["development", "test"] as const)("disallows everything in %s", async (nodeEnv) => {
    env.NODE_ENV = nodeEnv;

    expect(disallowed((await load()).body)).toEqual(["Disallow: /"]);
  });

  it("disallows everything in production with ROBOTS_DISALLOW_ALL", async () => {
    env.ROBOTS_DISALLOW_ALL = true;

    expect(disallowed((await load()).body)).toEqual(["Disallow: /"]);
  });

  it("keeps the normal rules with ROBOTS_DISALLOW_ALL=false", async () => {
    env.ROBOTS_DISALLOW_ALL = false;

    expect(disallowed((await load()).body)).toContain("Disallow: /koshyk");
  });
});
