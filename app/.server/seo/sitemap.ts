import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/i18n";

// Builds `/sitemap.xml` (#87): one `<url>` per page and locale, each with the `hreflang`
// alternates of every language version of the page, as Google expects for multilingual sites.

/** One page in every locale it exists in. */
export interface SitemapPage {
  /** The page's path in each locale it exists in, e.g. `{ uk: "/aktsii", en: "/en/offers" }`. */
  paths: Partial<Record<Locale, string>>;
  /** When the page last changed: an ISO datetime or a `YYYY-MM-DD` date; unknown when absent. */
  lastmod?: string;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text for an XML element or a quoted attribute. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** `siteUrl` (no trailing slash) plus a path; `/` stays the bare origin with its slash. */
function absolute(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${path}`;
}

function alternateLinks(siteUrl: string, paths: Partial<Record<Locale, string>>): string[] {
  const links: [hreflang: Locale | "x-default", path: string][] = LOCALES.flatMap((locale) => {
    const path = paths[locale];
    return path === undefined ? [] : [[locale, path] as [Locale, string]];
  });
  // `x-default` is the Ukrainian page, the shop's default language. A page without one (none
  // today) gets no `x-default` rather than pointing at a different language's page.
  const fallback = paths[DEFAULT_LOCALE];
  if (fallback !== undefined) links.push(["x-default", fallback]);
  return links.map(
    ([hreflang, path]) =>
      `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(absolute(siteUrl, path))}"/>`,
  );
}

/** The sitemap XML for `pages`, with absolute URLs on `siteUrl` (e.g. `https://jassmin.ua`). */
export function buildSitemapXml(pages: readonly SitemapPage[], siteUrl: string): string {
  const urls = pages.flatMap(({ paths, lastmod }) => {
    const alternates = alternateLinks(siteUrl, paths);
    return LOCALES.flatMap((locale) => {
      const path = paths[locale];
      if (path === undefined) return [];
      return [
        [
          "  <url>",
          `    <loc>${escapeXml(absolute(siteUrl, path))}</loc>`,
          ...(lastmod === undefined ? [] : [`    <lastmod>${escapeXml(lastmod)}</lastmod>`]),
          ...alternates,
          "  </url>",
        ].join("\n"),
      ];
    });
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
