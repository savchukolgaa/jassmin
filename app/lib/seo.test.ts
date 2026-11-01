import type { MetaDescriptor } from "react-router";
import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";
import {
  absoluteUrl,
  buildSeoMeta,
  canonicalUrl,
  DESCRIPTION_MAX_LENGTH,
  errorMeta,
  priceAmount,
  seoMeta,
  seoSite,
  truncateDescription,
} from "./seo";

const SITE = "https://jassmin.test";

function find(meta: MetaDescriptor[], key: "name" | "property", value: string) {
  return meta.filter((tag) => (tag as Record<string, unknown>)[key] === value);
}

function content(meta: MetaDescriptor[], key: "name" | "property", value: string) {
  const [tag] = find(meta, key, value);
  return tag && "content" in tag ? tag.content : undefined;
}

function canonical(meta: MetaDescriptor[]) {
  const tag = meta.find((d) => "tagName" in d && d.tagName === "link" && d.rel === "canonical");
  return tag && "href" in tag ? tag.href : undefined;
}

describe("truncateDescription", () => {
  it("leaves short text alone, collapsing whitespace", () => {
    expect(truncateDescription("  Парфуми   для\nнеї  ")).toBe("Парфуми для неї");
  });

  it("cuts long text on a word boundary, within the limit, with an ellipsis", () => {
    const text = "Аромати Jassmin ".repeat(20);
    const short = truncateDescription(text);

    expect(short.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(short.endsWith("Jassmin…") || short.endsWith("Аромати…")).toBe(true);
  });

  it("never cuts a word in half", () => {
    const short = truncateDescription(`${"a".repeat(150)} bbbbbbbbbb`, 155);
    expect(short).toBe(`${"a".repeat(150)}…`);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(truncateDescription("one two, three four", 12)).toBe("one two…");
  });

  it("cuts a single overlong word at the limit", () => {
    expect(truncateDescription("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("absoluteUrl", () => {
  it("resolves site-relative URLs against the origin", () => {
    expect(absoluteUrl("/og-default.jpg", SITE)).toBe(`${SITE}/og-default.jpg`);
    expect(absoluteUrl("img/a.jpg", SITE)).toBe(`${SITE}/img/a.jpg`);
  });

  it("keeps absolute URLs", () => {
    expect(absoluteUrl("https://cdn.example/a.jpg", SITE)).toBe("https://cdn.example/a.jpg");
    expect(absoluteUrl("//cdn.example/a.jpg", SITE)).toBe("https://cdn.example/a.jpg");
  });
});

describe("canonicalUrl", () => {
  it("drops tracking parameters", () => {
    expect(
      canonicalUrl(SITE, {
        pathname: "/catalog/women",
        search: "?utm_source=ig&utm_medium=story&fbclid=abc&gclid=x",
      }),
    ).toBe(`${SITE}/catalog/women`);
  });

  it("drops filter parameters that aren't kept", () => {
    expect(
      canonicalUrl(SITE, { pathname: "/popular", search: "?family=woody&family=citrus" }, ["page"]),
    ).toBe(`${SITE}/popular`);
  });

  it("keeps listed parameters, except page 1", () => {
    expect(
      canonicalUrl(SITE, { pathname: "/blog", search: "?utm_source=x&page=2" }, ["page"]),
    ).toBe(`${SITE}/blog?page=2`);
    expect(canonicalUrl(SITE, { pathname: "/blog", search: "?page=1" }, ["page"])).toBe(
      `${SITE}/blog`,
    );
  });

  it("strips a trailing slash except on the home page", () => {
    expect(canonicalUrl(SITE, { pathname: "/offers/", search: "" })).toBe(`${SITE}/offers`);
    expect(canonicalUrl(SITE, { pathname: "/", search: "?utm_source=x" })).toBe(`${SITE}/`);
  });
});

describe("buildSeoMeta", () => {
  const location = { pathname: "/offers", search: "?utm_campaign=x" };

  it("builds the full set of tags for an indexable page", () => {
    const meta = buildSeoMeta(
      { translator: createTranslator("uk"), siteUrl: SITE, location },
      { title: "Акції — Jassmin", description: "Опис" },
    );

    expect(meta).toContainEqual({ title: "Акції — Jassmin" });
    expect(content(meta, "name", "description")).toBe("Опис");
    expect(canonical(meta)).toBe(`${SITE}/offers`);
    expect(content(meta, "property", "og:url")).toBe(`${SITE}/offers`);
    expect(content(meta, "property", "og:type")).toBe("website");
    expect(content(meta, "property", "og:site_name")).toBe("Jassmin");
    expect(content(meta, "property", "og:title")).toBe("Акції — Jassmin");
    expect(content(meta, "property", "og:description")).toBe("Опис");
    expect(content(meta, "property", "og:image")).toBe(`${SITE}/og-default.jpg`);
    expect(content(meta, "property", "og:image:alt")).toBe("Jassmin — магазин парфумів");
    expect(content(meta, "property", "og:image:width")).toBe("1200");
    expect(content(meta, "name", "twitter:card")).toBe("summary_large_image");
    expect(content(meta, "name", "twitter:image")).toBe(`${SITE}/og-default.jpg`);
    expect(find(meta, "name", "robots")).toEqual([]);
  });

  it("sets og:locale from the active locale and the other one as alternate", () => {
    const uk = buildSeoMeta(
      { translator: createTranslator("uk"), siteUrl: SITE, location },
      { title: "t", description: "d" },
    );
    const en = buildSeoMeta(
      { translator: createTranslator("en"), siteUrl: SITE, location },
      { title: "t", description: "d" },
    );

    expect(content(uk, "property", "og:locale")).toBe("uk_UA");
    expect(content(uk, "property", "og:locale:alternate")).toBe("en_US");
    expect(content(en, "property", "og:locale")).toBe("en_US");
    expect(content(en, "property", "og:locale:alternate")).toBe("uk_UA");
    expect(content(en, "property", "og:image:alt")).toBe("Jassmin — perfume shop");
  });

  it("makes a page's own image absolute and uses its alt text", () => {
    const meta = buildSeoMeta(
      { translator: createTranslator("uk"), siteUrl: SITE, location },
      { title: "t", description: "d", image: { url: "/uploads/a.jpg", alt: "Флакон" } },
    );

    expect(content(meta, "property", "og:image")).toBe(`${SITE}/uploads/a.jpg`);
    expect(content(meta, "property", "og:image:alt")).toBe("Флакон");
    expect(find(meta, "property", "og:image:width")).toEqual([]);
  });

  it("truncates the description", () => {
    const meta = buildSeoMeta(
      { translator: createTranslator("uk"), siteUrl: SITE, location },
      { title: "t", description: "слово ".repeat(60) },
    );

    expect(String(content(meta, "name", "description")).length).toBeLessThanOrEqual(155);
    expect(content(meta, "property", "og:description")).toBe(content(meta, "name", "description"));
  });

  it("marks noindex pages noindex, follow without a canonical URL", () => {
    const meta = buildSeoMeta(
      {
        translator: createTranslator("uk"),
        siteUrl: SITE,
        location: { pathname: "/cart", search: "" },
      },
      { title: "Кошик — Jassmin", description: "d", noindex: true },
    );

    expect(content(meta, "name", "robots")).toBe("noindex, follow");
    expect(canonical(meta)).toBeUndefined();
    expect(find(meta, "property", "og:url")).toEqual([]);
  });

  it("appends extra tags", () => {
    const meta = buildSeoMeta(
      { translator: createTranslator("uk"), siteUrl: SITE, location },
      {
        title: "t",
        description: "d",
        type: "product",
        extra: [{ property: "product:price:currency", content: "UAH" }],
      },
    );

    expect(content(meta, "property", "og:type")).toBe("product");
    expect(content(meta, "property", "product:price:currency")).toBe("UAH");
  });
});

describe("seoMeta", () => {
  it("reads the locale and the public origin from the root loader data", () => {
    const meta = seoMeta(
      {
        matches: [{ id: "root", loaderData: { locale: "en", site: { url: `${SITE}/` } } }],
        location: { pathname: "/privacy", search: "" },
      },
      { title: "Privacy — Jassmin", description: "d" },
    );

    expect(canonical(meta)).toBe(`${SITE}/privacy`);
    expect(content(meta, "property", "og:locale")).toBe("en_US");
  });
});

describe("seoSite", () => {
  it("falls back to relative URLs without root data", () => {
    expect(seoSite(undefined)).toEqual({ url: "" });
    expect(seoSite([{ id: "root", loaderData: { site: { url: 3 } } }])).toEqual({ url: "" });
  });
});

describe("errorMeta", () => {
  const matches = [{ id: "root", loaderData: { locale: "uk", site: { url: SITE } } }];

  it("titles a 404 and marks it noindex", () => {
    const meta = errorMeta({
      matches,
      error: { status: 404, statusText: "", internal: false, data: null },
    });
    expect(meta).toEqual([
      { title: "Сторінку не знайдено — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
  });

  it("marks other errors noindex too", () => {
    const meta = errorMeta({ matches, error: new Error("boom") });
    expect(meta).toContainEqual({ name: "robots", content: "noindex, follow" });
    expect(meta).toContainEqual({ title: "Ой! — Jassmin" });
  });
});

describe("priceAmount", () => {
  it("formats a decimal price for Open Graph", () => {
    expect(priceAmount("1250")).toBe("1250.00");
    expect(priceAmount("899.5")).toBe("899.50");
  });
});
