import { describe, expect, it } from "vitest";
import { PAGE_KEYS, PAGES } from "~/lib/paths";
import { buildRobotsTxt, ROBOTS_SYSTEM_PATHS, robotsDisallowPaths } from "./robots";

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

describe("robotsDisallowPaths", () => {
  const paths = robotsDisallowPaths();
  const blocked = (path: string) =>
    paths.some((rule) => path === rule || path.startsWith(rule.endsWith("/") ? rule : `${rule}/`));

  it("blocks every page that isn't indexable, in both languages and at its path before #84", () => {
    for (const page of PAGE_KEYS.filter((key) => !PAGES[key].indexable)) {
      const params = { orderId: "42", id: "42", giftCardId: "42" };
      for (const pattern of [`/${PAGES[page].uk}`, `/en/${PAGES[page].en}`, `/${PAGES[page].en}`]) {
        const path = pattern.replace(/:(\w+)/g, (_, name: keyof typeof params) => params[name]);
        expect(blocked(path), path).toBe(true);
      }
    }
  });

  it("lists the Ukrainian and English cart, and the old /cart", () => {
    expect(paths).toEqual(expect.arrayContaining(["/koshyk", "/en/cart", "/cart"]));
  });

  it("blocks the action-only and system paths", () => {
    expect(paths).toEqual(expect.arrayContaining([...ROBOTS_SYSTEM_PATHS]));
  });

  it("never blocks an indexable page", () => {
    for (const page of PAGE_KEYS.filter((key) => PAGES[key].indexable)) {
      for (const locale of ["uk", "en"] as const) {
        const pattern = PAGES[page][locale].replace(/:(\w+)/g, "x");
        const path = locale === "en" ? `/en/${pattern}`.replace(/\/$/, "") : `/${pattern}`;
        expect(
          paths.some((rule) => rule !== "/" && path.startsWith(rule)),
          path,
        ).toBe(false);
      }
    }
  });
});
