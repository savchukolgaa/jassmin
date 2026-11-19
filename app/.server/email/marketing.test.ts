import { describe, expect, it } from "vitest";
import { listUnsubscribeHeaders, photoOf, unsubscribeUrl, withUtm } from "./marketing";

const site = "https://jassmin.ua";
const utm = { utm_source: "newsletter", utm_medium: "email", utm_campaign: "autumn" };
const tags = "utm_source=newsletter&utm_medium=email&utm_campaign=autumn";

describe("withUtm", () => {
  it("tags the shop's paths and absolute URLs, keeping their other parameters", () => {
    expect(withUtm("/catalog/women", site, utm)).toBe(`${site}/catalog/women?${tags}`);
    expect(withUtm("https://jassmin.ua/en/offers?page=2#top", site, utm)).toBe(
      `${site}/en/offers?page=2&${tags}#top`,
    );
  });

  it("replaces the link's own UTM tags", () => {
    expect(withUtm(`${site}/?utm_source=instagram&UTM_MEDIUM=social&x=1`, site, utm)).toBe(
      `${site}/?x=1&${tags}`,
    );
  });

  it("leaves other sites, mail and phone links and non-URLs alone", () => {
    for (const href of [
      "https://instagram.com/jassmin",
      "http://jassmin.ua/catalog",
      "//evil.example/x",
      "mailto:hello@jassmin.ua",
      "tel:+380441234567",
      "javascript:alert(1)",
      "catalog/women",
    ]) {
      expect(withUtm(href, site, utm)).toBe(href);
    }
  });
});

describe("marketing helpers", () => {
  it("builds the unsubscribe URL and its one-click headers", () => {
    const url = unsubscribeUrl(site, "en", "7.sig");
    expect(url).toBe(`${site}/en/unsubscribe/7.sig`);
    expect(listUnsubscribeHeaders(url)).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("serves Strapi photos from the site and falls back to the shop's bottle", () => {
    expect(photoOf("/uploads/a.jpg", site)).toBe(`${site}/uploads/a.jpg`);
    expect(photoOf("http://localhost:1337/uploads/a.jpg", site)).toBe(`${site}/uploads/a.jpg`);
    expect(photoOf(null, site)).toBe(`${site}/email/shop-bottle.jpg`);
    expect(photoOf("javascript:x", site)).toBe(`${site}/email/shop-bottle.jpg`);
  });
});
