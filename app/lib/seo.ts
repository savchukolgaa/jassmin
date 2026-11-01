// Page `<head>` metadata (#85): title, description, canonical URL, Open Graph, Twitter card and
// robots, built by one helper so every route says the same things the same way. Isomorphic: route
// `meta` functions run on the server and in the browser.
import type { MetaDescriptor } from "react-router";
import { LOCALES, type Locale, metaTranslator, type Translator } from "./i18n";
import { describeRouteError } from "./route-error";

/** `og:site_name`: the brand, the same in every language. */
export const SITE_NAME = "Jassmin";

/** Search engines show about this many characters of a description. */
export const DESCRIPTION_MAX_LENGTH = 155;

/** The share image for pages without their own (1200×630, `public/og-default.jpg`). */
export const DEFAULT_SHARE_IMAGE = { url: "/og-default.jpg", width: 1200, height: 630 } as const;

/** `og:locale` values: Open Graph uses `language_TERRITORY`. */
export const OG_LOCALES: Record<Locale, string> = { uk: "uk_UA", en: "en_US" };

export const NOINDEX = "noindex, follow";

/** The site's public origin, from the root loader; `""` (relative URLs) if that failed. */
export interface SeoSite {
  url: string;
}

export interface SeoImage {
  /** Absolute, or relative to the site. */
  url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

/** The parts of a route's `MetaArgs` the helper reads. */
export interface SeoContext {
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined> | undefined;
  location: { pathname: string; search: string };
}

export interface SeoOptions {
  /** The full `<title>`, usually `t("meta.title", { page })`. */
  title: string;
  description: string;
  /** Query parameters that are part of the canonical URL (e.g. `page`); all others are dropped. */
  keepParams?: readonly string[];
  /** Defaults to `DEFAULT_SHARE_IMAGE`. */
  image?: SeoImage | null;
  type?: "website" | "article" | "product";
  /** Private, transactional and error pages: `noindex, follow`, and no canonical URL. */
  noindex?: boolean;
  /** More tags, e.g. `product:price:amount` or `article:published_time`. */
  extra?: MetaDescriptor[];
}

/** Reads the site's public origin from the root loader's data, like `metaTranslator`. */
export function seoSite(matches: SeoContext["matches"]): SeoSite {
  const root = matches?.find((match) => match?.id === "root")?.loaderData;
  const site = typeof root === "object" && root !== null && "site" in root ? root.site : undefined;
  const url =
    typeof site === "object" && site !== null && "url" in site && typeof site.url === "string"
      ? site.url
      : "";
  return { url: url.replace(/\/+$/, "") };
}

/**
 * Collapses whitespace and shortens `text` to at most `max` characters, cutting at a word boundary
 * and ending with `…`.
 */
export function truncateDescription(text: string, max: number = DESCRIPTION_MAX_LENGTH): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max); // room for the ellipsis after trimming the partial word
  const lastSpace = cut.lastIndexOf(" ");
  const words = lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, max - 1);
  return `${words.replace(/[\s,;:.!?\-–—]+$/u, "")}…`;
}

/** Resolves a site-relative URL against the public origin; absolute URLs pass through. */
export function absoluteUrl(url: string, siteUrl: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return `${siteUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * The page's canonical URL: the public origin, the path without a trailing slash, and only the
 * `keepParams` query parameters (in that order; `page=1` is dropped). Tracking (`utm_*`,
 * `fbclid`, `gclid`) and filter parameters therefore never reach it.
 */
export function canonicalUrl(
  siteUrl: string,
  location: SeoContext["location"],
  keepParams: readonly string[] = [],
): string {
  const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : "/";
  const params = new URLSearchParams(location.search);
  const kept = new URLSearchParams();
  for (const key of keepParams) {
    const value = params.get(key);
    if (value && !(key === "page" && value === "1")) {
      kept.set(key, value);
    }
  }
  const query = kept.toString();
  return `${siteUrl}${path || "/"}${query ? `?${query}` : ""}`;
}

/** The `meta` descriptors for one page. */
export function seoMeta(context: SeoContext, options: SeoOptions): MetaDescriptor[] {
  const translator = metaTranslator(context.matches);
  const { url: siteUrl } = seoSite(context.matches);
  return buildSeoMeta({ translator, siteUrl, location: context.location }, options);
}

/** `seoMeta` with the translator and origin given directly (for tests). */
export function buildSeoMeta(
  {
    translator,
    siteUrl,
    location,
  }: { translator: Translator; siteUrl: string; location: SeoContext["location"] },
  {
    title,
    description: fullDescription,
    keepParams,
    image,
    type = "website",
    noindex = false,
    extra = [],
  }: SeoOptions,
): MetaDescriptor[] {
  const { t, locale } = translator;
  const description = truncateDescription(fullDescription);
  const share: SeoImage = image ?? { ...DEFAULT_SHARE_IMAGE, alt: t("meta.defaultImageAlt") };
  const imageUrl = absoluteUrl(share.url, siteUrl);
  const imageAlt = share.alt || title;
  const url = canonicalUrl(siteUrl, location, keepParams);

  return [
    { title },
    { name: "description", content: description },
    ...(noindex
      ? [{ name: "robots", content: NOINDEX }]
      : [
          { tagName: "link", rel: "canonical", href: url },
          { property: "og:url", content: url },
        ]),
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:locale", content: OG_LOCALES[locale] },
    ...LOCALES.filter((other) => other !== locale).map((other) => ({
      property: "og:locale:alternate",
      content: OG_LOCALES[other],
    })),
    { property: "og:image", content: imageUrl },
    { property: "og:image:alt", content: imageAlt },
    ...(share.width && share.height
      ? [
          { property: "og:image:width", content: String(share.width) },
          { property: "og:image:height", content: String(share.height) },
        ]
      : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    { name: "twitter:image:alt", content: imageAlt },
    ...extra,
  ];
}

/**
 * Private and transactional pages (cart, checkout, account, …): a title and `noindex, follow`.
 * They're never shared, so no canonical URL or Open Graph tags.
 */
export function noindexMeta(title: string): MetaDescriptor[] {
  return [{ title }, { name: "robots", content: NOINDEX }];
}

/**
 * The `meta` for a page that failed to render (404, 503, 500): a translated title and
 * `noindex, follow`, so error pages never end up in search results.
 */
export function errorMeta({
  matches,
  error,
  notFoundTitle,
}: {
  matches: SeoContext["matches"];
  error: unknown;
  /** The page part of a 404's title, e.g. "Article not found"; "Page not found" by default. */
  notFoundTitle?: string;
}): MetaDescriptor[] {
  const { t } = metaTranslator(matches);
  const { message } = describeRouteError(error, t, false);
  const page = message === "404" ? (notFoundTitle ?? t("errors.notFoundTitle")) : t("errors.title");
  return noindexMeta(t("meta.title", { page }));
}

/** A `numeric(10, 2)` price as Open Graph's plain decimal amount, e.g. `"1250.00"`. */
export function priceAmount(price: string): string {
  const value = Number(price);
  return Number.isFinite(value) ? value.toFixed(2) : price;
}
