import { describe, expect, it, vi } from "vitest";
import type { SocialLink } from "~/lib/cms";

const social = vi.hoisted(() => ({ getSocialLinks: vi.fn() }));
vi.mock("~/.server/cms/social", () => social);
vi.mock("~/.server/services/header", () => ({
  getHeaderState: vi.fn(async () => ({ user: null, cartCount: 0 })),
}));
vi.mock("~/.server/consent", () => ({ getConsent: vi.fn(async () => "granted") }));
vi.mock("~/.server/analytics-middleware", () => ({ visitorMiddleware: vi.fn() }));

const { loader } = await import("./_shop");

type LoaderArgs = Parameters<typeof loader>[0];

function load(url = "http://localhost/en/catalog/women") {
  return loader({ request: new Request(url), params: {}, context: {} } as unknown as LoaderArgs);
}

describe("_shop loader", () => {
  it("returns the store's social links in the page's locale for the footer and menu (#101)", async () => {
    const links: SocialLink[] = [{ platform: "instagram", url: "https://www.instagram.com/x" }];
    social.getSocialLinks.mockResolvedValue(links);

    const data = await load();

    expect(data.socialLinks).toEqual(links);
    expect(social.getSocialLinks).toHaveBeenCalledWith("en");
  });

  it("returns no links when Strapi is down, without failing the page", async () => {
    social.getSocialLinks.mockResolvedValue([]);

    await expect(load("http://localhost/")).resolves.toMatchObject({ socialLinks: [] });
    expect(social.getSocialLinks).toHaveBeenCalledWith("uk");
  });
});
