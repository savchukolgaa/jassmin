import { describe, expect, it } from "vitest";
import { LOCALES } from "./i18n/locales";
import {
  crossesLocale,
  localeFromPath,
  localizeInternalPath,
  matchLegacyPath,
  matchPage,
  PAGE_KEYS,
  PAGES,
  PARAM_SEGMENTS,
  type Page,
  pageRouteId,
  parsePageRouteId,
  pathFor,
  translatePath,
} from "./paths";

/** Sample parameters for every page that has some. */
const SAMPLE_PARAMS: Partial<Record<Page, Record<string, string>>> = {
  catalog: { gender: "women" },
  product: { handle: "bleu-de-chanel" },
  blogPost: { slug: "spring-notes" },
  checkoutSuccess: { orderId: "42" },
  checkoutPay: { orderId: "42" },
  accountOrder: { id: "7" },
  giftCardSuccess: { giftCardId: "3" },
};

const build = pathFor as (
  locale: (typeof LOCALES)[number],
  page: Page,
  params?: Record<string, string>,
) => string;

describe("the path table", () => {
  it("gives every page a pattern in each locale made of lowercase ASCII segments", () => {
    for (const page of PAGE_KEYS) {
      for (const locale of LOCALES) {
        const pattern: string = PAGES[page][locale];
        for (const segment of pattern.split("/").filter(Boolean)) {
          expect(segment, `${page}.${locale}`).toMatch(/^(?:[a-z0-9-]+|:[a-zA-Z]+)$/);
        }
      }
    }
  });

  it("uses the same parameters in both locales", () => {
    for (const page of PAGE_KEYS) {
      const names = (pattern: string) => pattern.match(/:\w+/g) ?? [];
      expect(names(PAGES[page].en), page).toEqual(names(PAGES[page].uk));
    }
  });

  it("has no two pages with the same pattern in a locale", () => {
    for (const locale of LOCALES) {
      const shapes = PAGE_KEYS.map((page) => PAGES[page][locale].replace(/:\w+/g, ":"));
      expect(new Set(shapes).size).toBe(shapes.length);
    }
  });

  it("translates parameter values into lowercase ASCII segments", () => {
    for (const values of Object.values(PARAM_SEGMENTS.catalog)) {
      for (const byLocale of Object.values(values)) {
        for (const locale of LOCALES) {
          expect(byLocale[locale]).toMatch(/^[a-z0-9-]+$/);
        }
      }
    }
  });
});

describe("pathFor", () => {
  it("builds unprefixed Ukrainian and /en English URLs", () => {
    expect(pathFor("uk", "home")).toBe("/");
    expect(pathFor("en", "home")).toBe("/en");
    expect(pathFor("uk", "catalog", { gender: "women" })).toBe("/katalog/zhinochi");
    expect(pathFor("en", "catalog", { gender: "men" })).toBe("/en/catalog/men");
    expect(pathFor("uk", "product", { handle: "bleu" })).toBe("/parfumy/bleu");
    expect(pathFor("en", "accountOrder", { id: "7" })).toBe("/en/account/orders/7");
    expect(pathFor("uk", "checkoutSuccess", { orderId: "3" })).toBe("/oformlennia/uspikh/3");
  });

  it("adds the query and hash, and encodes parameters", () => {
    expect(pathFor("uk", "home", {}, { hash: "about" })).toBe("/#about");
    expect(pathFor("en", "home", {}, { hash: "#contacts" })).toBe("/en#contacts");
    expect(pathFor("uk", "blog", {}, { search: "page=2" })).toBe("/blog?page=2");
    expect(pathFor("en", "popular", {}, { search: new URLSearchParams({ family: "woody" }) })).toBe(
      "/en/popular?family=woody",
    );
    expect(pathFor("uk", "blog", {}, { search: "" })).toBe("/blog");
    expect(pathFor("uk", "blogPost", { slug: "a b" })).toBe("/blog/a%20b");
  });
});

describe("localeFromPath", () => {
  it("is English only under /en", () => {
    expect(localeFromPath("/en")).toBe("en");
    expect(localeFromPath("/en/cart")).toBe("en");
    expect(localeFromPath("/")).toBe("uk");
    expect(localeFromPath("/koshyk")).toBe("uk");
    expect(localeFromPath("/english")).toBe("uk");
  });
});

describe("crossesLocale", () => {
  const nav = (from: string, to: string) => ({
    currentUrl: new URL(from, "http://localhost"),
    nextUrl: new URL(to, "http://localhost"),
  });

  it("is true for a navigation into the other language, in either direction", () => {
    expect(crossesLocale(nav("/", "/en"))).toBe(true);
    expect(crossesLocale(nav("/en/catalog/women?sort=new", "/katalog/zhinochi?sort=new"))).toBe(
      true,
    );
  });

  it("is false within one language", () => {
    expect(crossesLocale(nav("/", "/koshyk"))).toBe(false);
    expect(crossesLocale(nav("/en", "/en/cart"))).toBe(false);
  });
});

describe("matchPage", () => {
  it("round-trips every page in every locale", () => {
    for (const page of PAGE_KEYS) {
      for (const locale of LOCALES) {
        const params = SAMPLE_PARAMS[page] ?? {};
        expect(matchPage(build(locale, page, params)), `${page}.${locale}`).toEqual({
          page,
          params,
          locale,
        });
      }
    }
  });

  it("returns logical parameter values and rejects unknown translated ones", () => {
    expect(matchPage("/katalog/cholovichi")?.params).toEqual({ gender: "men" });
    expect(matchPage("/katalog/men")).toBeNull();
    expect(matchPage("/en/catalog/zhinochi")).toBeNull();
  });

  it("ignores a trailing slash and doesn't match other paths", () => {
    expect(matchPage("/en/cart/")?.page).toBe("cart");
    expect(matchPage("/cart")).toBeNull();
    expect(matchPage("/en/koshyk")).toBeNull();
    expect(matchPage("/logout")).toBeNull();
  });
});

describe("translatePath", () => {
  it("gives the same page in the other locale, keeping the query and hash", () => {
    expect(translatePath("/katalog/zhinochi?page=2#top", "en")).toBe(
      "/en/catalog/women?page=2#top",
    );
    expect(translatePath("/en/account/orders/5", "uk")).toBe("/kabinet/zamovlennia/5");
    expect(translatePath("/en", "uk")).toBe("/");
    expect(translatePath("/#about", "en")).toBe("/en#about");
    expect(translatePath("/nope", "en")).toBeNull();
  });
});

describe("matchLegacyPath", () => {
  it("sends the English-segment paths from before #84 to the Ukrainian URL", () => {
    expect(matchLegacyPath("/catalog/women")).toBe("/katalog/zhinochi");
    expect(matchLegacyPath("/products/bleu?volume=50")).toBe("/parfumy/bleu?volume=50");
    expect(matchLegacyPath("/perfumes/bleu")).toBe("/parfumy/bleu");
    expect(matchLegacyPath("/cart")).toBe("/koshyk");
    expect(matchLegacyPath("/account/orders/3")).toBe("/kabinet/zamovlennia/3");
    expect(matchLegacyPath("/offers")).toBe("/aktsii");
  });

  it("drops /uk", () => {
    expect(matchLegacyPath("/uk")).toBe("/");
    expect(matchLegacyPath("/uk/koshyk")).toBe("/koshyk");
    expect(matchLegacyPath("/uk/cart?x=1")).toBe("/koshyk?x=1");
  });

  it("sends Ukrainian segments under /en to the English URL", () => {
    expect(matchLegacyPath("/en/koshyk")).toBe("/en/cart");
    expect(matchLegacyPath("/en/katalog/zhinochi")).toBe("/en/catalog/women");
  });

  it("returns null for unknown paths", () => {
    expect(matchLegacyPath("/en/nope")).toBeNull();
    expect(matchLegacyPath("/nope")).toBeNull();
    expect(matchLegacyPath("/catalog/kids")).toBeNull();
    expect(matchLegacyPath("/uk/nope")).toBeNull();
  });
});

describe("localizeInternalPath", () => {
  it("turns any page path or old path into the locale's URL", () => {
    expect(localizeInternalPath("/popular", "en")).toBe("/en/popular");
    expect(localizeInternalPath("/popular", "uk")).toBe("/populiarni");
    expect(localizeInternalPath("/catalog/women", "uk")).toBe("/katalog/zhinochi");
    expect(localizeInternalPath("/katalog/zhinochi", "en")).toBe("/en/catalog/women");
    expect(localizeInternalPath("/register", "en")).toBe("/en/register");
  });

  it("keeps paths that aren't pages", () => {
    expect(localizeInternalPath("/nope", "en")).toBe("/nope");
  });
});

describe("page route ids", () => {
  it("round-trip", () => {
    expect(parsePageRouteId(pageRouteId("catalog", "en"))).toEqual({
      page: "catalog",
      locale: "en",
    });
    expect(parsePageRouteId("routes/_shop")).toBeNull();
    expect(parsePageRouteId("root")).toBeNull();
  });
});
