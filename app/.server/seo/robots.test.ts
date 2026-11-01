import { describe, expect, it } from "vitest";
import { buildRobotsTxt } from "./robots";

const SITE = "https://jassmin.ua";

describe("buildRobotsTxt", () => {
  it("disallows the given paths, once each, and links the sitemap", () => {
    expect(
      buildRobotsTxt({
        siteUrl: SITE,
        disallowAll: false,
        disallow: ["/koshyk", "/en/cart", "/koshyk"],
      }),
    ).toBe(
      [
        "User-agent: *",
        "Disallow: /koshyk",
        "Disallow: /en/cart",
        "",
        "Sitemap: https://jassmin.ua/sitemap.xml",
        "",
      ].join("\n"),
    );
  });

  it("disallows everything, and only that, when disallowAll is set", () => {
    const txt = buildRobotsTxt({ siteUrl: `${SITE}/`, disallowAll: true, disallow: ["/koshyk"] });

    expect(txt.match(/^Disallow: .*$/gm)).toEqual(["Disallow: /"]);
    expect(txt).toContain("Sitemap: https://jassmin.ua/sitemap.xml\n");
  });
});
