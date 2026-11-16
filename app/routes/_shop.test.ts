import { describe, expect, it, vi } from "vitest";
import type { SocialLink } from "~/lib/cms";

const social = vi.hoisted(() => ({ getSocialLinks: vi.fn() }));
vi.mock("~/.server/cms/social", () => social);
vi.mock("~/.server/services/header", () => ({
  getHeaderState: vi.fn(async () => ({ user: null, cartCount: 0 })),
}));
vi.mock("~/.server/consent", () => ({ getConsent: vi.fn(async () => "granted") }));
vi.mock("~/.server/analytics-middleware", () => ({ visitorMiddleware: vi.fn() }));
const ai = vi.hoisted(() => ({ isPerfumerEnabled: vi.fn(() => false) }));
vi.mock("~/.server/ai/config", () => ai);

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

  it("answers a client-side navigation to /en in English (#112)", async () => {
    social.getSocialLinks.mockResolvedValue([]);

    const data = await load("http://localhost/en.data");

    expect(social.getSocialLinks).toHaveBeenLastCalledWith("en");
    expect(data.suggestEnglish).toBe(false);
  });

  it("says whether the AI perfumer is enabled, for its menu link (#163)", async () => {
    social.getSocialLinks.mockResolvedValue([]);

    await expect(load()).resolves.toMatchObject({ perfumerEnabled: false });
    ai.isPerfumerEnabled.mockReturnValue(true);
    await expect(load()).resolves.toMatchObject({ perfumerEnabled: true });
  });

  it("returns no links when Strapi is down, without failing the page", async () => {
    social.getSocialLinks.mockResolvedValue([]);

    await expect(load("http://localhost/")).resolves.toMatchObject({ socialLinks: [] });
    expect(social.getSocialLinks).toHaveBeenCalledWith("uk");
  });
});
