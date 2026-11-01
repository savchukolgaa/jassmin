// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSitemapXml, escapeXml, type SitemapPage } from "./sitemap";

const SITE = "https://jassmin.ua";
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Parses the XML strictly; a well-formedness error fails the test. */
function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new Error(`Invalid XML: ${error.textContent}`);
  return doc;
}

function urls(doc: Document) {
  return [...doc.getElementsByTagNameNS(SITEMAP_NS, "url")].map((url) => ({
    loc: url.getElementsByTagNameNS(SITEMAP_NS, "loc")[0]?.textContent,
    lastmod: url.getElementsByTagNameNS(SITEMAP_NS, "lastmod")[0]?.textContent,
    alternates: Object.fromEntries(
      [...url.getElementsByTagNameNS(XHTML_NS, "link")].map((link) => [
        link.getAttribute("hreflang"),
        link.getAttribute("href"),
      ]),
    ),
  }));
}

const offers: SitemapPage = {
  paths: { uk: "/aktsii", en: "/en/offers" },
  lastmod: "2026-10-01T10:00:00.000Z",
};

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("buildSitemapXml", () => {
  it("is well-formed XML in the sitemap namespace", () => {
    const doc = parse(buildSitemapXml([offers], SITE));

    expect(doc.documentElement.localName).toBe("urlset");
    expect(doc.documentElement.namespaceURI).toBe(SITEMAP_NS);
  });

  it("lists every locale with absolute URLs, lastmod and uk/en/x-default alternates", () => {
    const alternates = {
      uk: "https://jassmin.ua/aktsii",
      en: "https://jassmin.ua/en/offers",
      "x-default": "https://jassmin.ua/aktsii",
    };

    expect(urls(parse(buildSitemapXml([offers], SITE)))).toEqual([
      { loc: "https://jassmin.ua/aktsii", lastmod: offers.lastmod, alternates },
      { loc: "https://jassmin.ua/en/offers", lastmod: offers.lastmod, alternates },
    ]);
  });

  it("lists a page that exists in one locale only once, without the missing alternate", () => {
    const post: SitemapPage = { paths: { uk: "/blog/tilky-ukrainskoiu" }, lastmod: "2026-10-02" };

    expect(urls(parse(buildSitemapXml([post], SITE)))).toEqual([
      {
        loc: "https://jassmin.ua/blog/tilky-ukrainskoiu",
        lastmod: "2026-10-02",
        alternates: {
          uk: "https://jassmin.ua/blog/tilky-ukrainskoiu",
          "x-default": "https://jassmin.ua/blog/tilky-ukrainskoiu",
        },
      },
    ]);
  });

  it("escapes URLs, so the XML stays valid", () => {
    const page: SitemapPage = { paths: { uk: "/blog/a&b<c>" }, lastmod: "2026-10-02" };
    const xml = buildSitemapXml([page], SITE);

    expect(xml).toContain("<loc>https://jassmin.ua/blog/a&amp;b&lt;c&gt;</loc>");
    expect(urls(parse(xml))[0]?.loc).toBe("https://jassmin.ua/blog/a&b<c>");
  });

  it("keeps the home page's slash and ignores a trailing slash on the site URL", () => {
    const home: SitemapPage = { paths: { uk: "/", en: "/en" }, lastmod: "2026-10-02" };

    expect(urls(parse(buildSitemapXml([home], `${SITE}/`))).map((url) => url.loc)).toEqual([
      "https://jassmin.ua/",
      "https://jassmin.ua/en",
    ]);
  });

  it("is an empty urlset without pages", () => {
    expect(urls(parse(buildSitemapXml([], SITE)))).toEqual([]);
  });
});
