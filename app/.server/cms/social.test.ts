import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteSettings, SocialLink } from "~/lib/cms";
import { CmsError } from "./errors";

const content = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
vi.mock("./content", () => content);

const { getSocialLinks, resetSocialLinksCache, SOCIAL_LINKS_RETRY_MS, SOCIAL_LINKS_TTL_MS } =
  await import("./social");

const instagram: SocialLink = { platform: "instagram", url: "https://www.instagram.com/jassmin" };
const telegram: SocialLink = { platform: "telegram", url: "https://t.me/jassmin" };

function settings(socialLinks: SocialLink[]): SiteSettings {
  return {
    locale: "uk",
    phone: "+380 44 123 45 67",
    email: "hello@jassmin.ua",
    customerServiceHours: null,
    legalName: null,
    socialLinks,
  };
}

describe("getSocialLinks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocialLinksCache();
    content.getSiteSettings.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the site settings in the given locale", async () => {
    content.getSiteSettings.mockResolvedValue(settings([instagram]));

    await expect(getSocialLinks("en")).resolves.toEqual([instagram]);
    expect(content.getSiteSettings).toHaveBeenCalledWith("en");
  });

  it("reuses the links within the TTL, per locale, and shares concurrent reads", async () => {
    content.getSiteSettings.mockResolvedValue(settings([instagram]));

    await Promise.all([getSocialLinks("uk"), getSocialLinks("uk")]);
    vi.advanceTimersByTime(SOCIAL_LINKS_TTL_MS - 1);
    await getSocialLinks("uk");
    expect(content.getSiteSettings).toHaveBeenCalledTimes(1);

    await getSocialLinks("en");
    expect(content.getSiteSettings).toHaveBeenCalledTimes(2);
  });

  it("picks up a link added in Strapi once the TTL is over, without a deploy", async () => {
    content.getSiteSettings.mockResolvedValueOnce(settings([instagram]));
    content.getSiteSettings.mockResolvedValueOnce(settings([instagram, telegram]));

    await expect(getSocialLinks("uk")).resolves.toEqual([instagram]);
    vi.advanceTimersByTime(SOCIAL_LINKS_TTL_MS);
    await expect(getSocialLinks("uk")).resolves.toEqual([instagram, telegram]);
  });

  it("returns no links when Strapi is down, and waits before retrying", async () => {
    content.getSiteSettings.mockRejectedValue(new CmsError("unreachable", "fetch failed"));

    await expect(getSocialLinks("uk")).resolves.toEqual([]);
    await getSocialLinks("uk");
    expect(content.getSiteSettings).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SOCIAL_LINKS_RETRY_MS);
    await getSocialLinks("uk");
    expect(content.getSiteSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps the last links when Strapi goes down", async () => {
    content.getSiteSettings.mockResolvedValueOnce(settings([instagram]));
    content.getSiteSettings.mockRejectedValueOnce(new CmsError("timeout", "too slow"));

    await getSocialLinks("uk");
    vi.advanceTimersByTime(SOCIAL_LINKS_TTL_MS);
    await expect(getSocialLinks("uk")).resolves.toEqual([instagram]);
  });

  it("never rejects, even on an unexpected error", async () => {
    content.getSiteSettings.mockRejectedValue(new TypeError("boom"));

    await expect(getSocialLinks("uk")).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
