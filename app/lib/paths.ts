// Every page's URL in each language (#84), and the helpers that build, match and translate them.
// Isomorphic: no server imports. `app/routes.ts` registers each page under both patterns, so this
// table is the single place where paths are written.
//
// Ukrainian pages are unprefixed, with Ukrainian words transliterated into Latin letters (Cabinet
// of Ministers resolution No. 55, 2010). English pages live under `/en/` with English words. The
// URL alone decides the language: `localeFromPath`.
import { matchPath } from "react-router";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n/locales";

interface PageDefinition {
  /** React Router patterns without a leading slash or locale prefix; `""` is the index. */
  readonly uk: string;
  readonly en: string;
  /** Whether search engines should index the page: it gets `hreflang` alternates. */
  readonly indexable: boolean;
}

export const PAGES = {
  home: { uk: "", en: "", indexable: true },
  catalog: { uk: "katalog/:gender", en: "catalog/:gender", indexable: true },
  product: { uk: "parfumy/:handle", en: "perfumes/:handle", indexable: true },
  offers: { uk: "aktsii", en: "offers", indexable: true },
  popular: { uk: "populiarni", en: "popular", indexable: true },
  blog: { uk: "blog", en: "blog", indexable: true },
  blogPost: { uk: "blog/:slug", en: "blog/:slug", indexable: true },
  cart: { uk: "koshyk", en: "cart", indexable: false },
  checkout: { uk: "oformlennia", en: "checkout", indexable: false },
  checkoutSuccess: {
    uk: "oformlennia/uspikh/:orderId",
    en: "checkout/success/:orderId",
    indexable: false,
  },
  // POST only: a new card payment attempt from the success page (#44).
  checkoutPay: { uk: "oformlennia/oplata/:orderId", en: "checkout/pay/:orderId", indexable: false },
  login: { uk: "vkhid", en: "login", indexable: false },
  register: { uk: "reiestratsiia", en: "register", indexable: false },
  account: { uk: "kabinet", en: "account", indexable: false },
  accountOrder: { uk: "kabinet/zamovlennia/:id", en: "account/orders/:id", indexable: false },
  accountProfile: { uk: "kabinet/profil", en: "account/profile", indexable: false },
  privacy: { uk: "konfidentsiinist", en: "privacy", indexable: true },
} as const satisfies Record<string, PageDefinition>;

export type Page = keyof typeof PAGES;

export const PAGE_KEYS = Object.keys(PAGES) as Page[];

/**
 * Parameters whose values are words, translated like the path: the logical value (what loaders
 * see, e.g. `women`) → its segment in each locale.
 */
export const PARAM_SEGMENTS = {
  catalog: {
    gender: {
      women: { uk: "zhinochi", en: "women" },
      men: { uk: "cholovichi", en: "men" },
    },
  },
} as const satisfies Partial<Record<Page, Record<string, Record<string, Record<Locale, string>>>>>;

/** Paths from before #84 that aren't the English pattern without its prefix. */
const LEGACY_PATTERNS: Partial<Record<Page, string>> = { product: "products/:handle" };

/** The prefix of every English URL. */
export const EN_PREFIX = "/en";

type ParamNames<S extends string> = S extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : S extends `${string}:${infer Name}`
    ? Name
    : never;

/** A page's parameters, e.g. `{ handle: string }` for `product`. */
export type PageParams<P extends Page> = { [K in ParamNames<(typeof PAGES)[P]["uk"]>]: string };

export interface PathOptions {
  /** A query string (with or without `?`) or search params; empty ones are dropped. */
  search?: string | URLSearchParams;
  /** A fragment (with or without `#`). */
  hash?: string;
}

export type PathArgs<P extends Page> = [ParamNames<(typeof PAGES)[P]["uk"]>] extends [never]
  ? [params?: Record<string, never>, options?: PathOptions]
  : [params: PageParams<P>, options?: PathOptions];

function translateParam(page: Page, name: string, value: string, locale: Locale): string {
  const segments = (
    PARAM_SEGMENTS as Record<string, Record<string, Record<string, Record<Locale, string>>>>
  )[page]?.[name];
  return segments?.[value]?.[locale] ?? value;
}

/**
 * A route parameter's logical value from its URL segment in `locale`, e.g. the catalog's
 * `zhinochi` → `women`; `null` for a segment that isn't one of its values. Loaders get the raw
 * segment in `params`.
 */
export function paramFromSegment(
  page: Page,
  name: string,
  segment: string | undefined,
  locale: Locale,
): string | null {
  return segment === undefined ? null : untranslateParam(page, name, segment, locale);
}

function untranslateParam(
  page: Page,
  name: string,
  segment: string,
  locale: Locale,
): string | null {
  const segments = (
    PARAM_SEGMENTS as Record<string, Record<string, Record<string, Record<Locale, string>>>>
  )[page]?.[name];
  if (!segments) {
    return segment;
  }
  const entry = Object.entries(segments).find(([, bySegment]) => bySegment[locale] === segment);
  return entry ? entry[0] : null;
}

function withLocalePrefix(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) {
    return `/${path}`;
  }
  return path ? `${EN_PREFIX}/${path}` : EN_PREFIX;
}

function appendSearchAndHash(path: string, { search, hash }: PathOptions = {}): string {
  const query = typeof search === "string" ? search.replace(/^\?/, "") : (search?.toString() ?? "");
  const fragment = hash?.replace(/^#/, "") ?? "";
  return `${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}

/**
 * The URL of `page` in `locale`: every internal link, form action and redirect is built with it,
 * e.g. `pathFor("en", "catalog", { gender: "women" })` → `/en/catalog/women`.
 */
export function pathFor<P extends Page>(
  locale: Locale,
  page: P,
  ...[params, options]: PathArgs<P>
): string {
  const values = (params ?? {}) as Record<string, string>;
  const pattern: string = PAGES[page][locale];
  const path = pattern.replace(/:(\w+)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`pathFor("${page}"): missing parameter "${name}"`);
    }
    return encodeURIComponent(translateParam(page, name, value, locale));
  });
  return appendSearchAndHash(withLocalePrefix(path, locale), options);
}

/** `pathFor` with the locale already chosen, as `usePathFor()` returns it. */
export type PathBuilder = <P extends Page>(page: P, ...args: PathArgs<P>) => string;

/** The language of a URL path: English under `/en`, Ukrainian everywhere else. */
export function localeFromPath(pathname: string): Locale {
  return pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`) ? "en" : DEFAULT_LOCALE;
}

/**
 * Whether a navigation goes into the other language, e.g. the redirect after the language
 * switcher: every `shouldRevalidate` reloads then, so no loader keeps the old language (#112).
 */
export function crossesLocale({ currentUrl, nextUrl }: { currentUrl: URL; nextUrl: URL }): boolean {
  return localeFromPath(currentUrl.pathname) !== localeFromPath(nextUrl.pathname);
}

/** The path without its locale prefix and slashes at either end: `/en/cart/` → `cart`. */
function stripLocale(pathname: string, locale: Locale): string {
  const rest = locale === DEFAULT_LOCALE ? pathname : pathname.slice(EN_PREFIX.length);
  return rest.replace(/^\/+|\/+$/g, "");
}

export interface PageMatch<P extends Page = Page> {
  page: P;
  /** Logical values: the catalog's `gender` is `women`, whatever the locale. */
  params: Record<string, string>;
  locale: Locale;
}

/** Matches `rest` (no prefix) against each page's `patternOf`, untranslating parameters in `locale`. */
function matchPattern(
  rest: string,
  locale: Locale,
  patternOf: (page: Page) => string | undefined,
): Omit<PageMatch, "locale"> | null {
  for (const page of PAGE_KEYS) {
    const pattern = patternOf(page);
    if (pattern === undefined) {
      continue;
    }
    const match = matchPath({ path: `/${pattern}`, end: true, caseSensitive: true }, `/${rest}`);
    if (!match) {
      continue;
    }
    const params: Record<string, string> = {};
    let valid = true;
    for (const [name, value] of Object.entries(match.params)) {
      const logical = value === undefined ? null : untranslateParam(page, name, value, locale);
      if (logical === null || logical === "") {
        valid = false;
        break;
      }
      params[name] = logical;
    }
    if (valid) {
      return { page, params };
    }
  }
  return null;
}

/** The page a URL path shows, in the language of the URL, or `null` for anything else. */
export function matchPage(pathname: string): PageMatch | null {
  const locale = localeFromPath(pathname);
  const match = matchPattern(stripLocale(pathname, locale), locale, (page) => PAGES[page][locale]);
  return match ? { ...match, locale } : null;
}

/** The page a link, form action or `formAction` (`/en?index`) points to, in either language. */
export function pageOf(path: string | undefined): Page | null {
  return path === undefined ? null : (matchPage(path.split(/[?#]/)[0] ?? "")?.page ?? null);
}

/** `pathFor` with the parameters of a match; they're already checked by `matchPage`. */
function pathForMatch(
  locale: Locale,
  { page, params }: Omit<PageMatch, "locale">,
  options?: PathOptions,
): string {
  return (
    pathFor as (
      locale: Locale,
      page: Page,
      params: Record<string, string>,
      options?: PathOptions,
    ) => string
  )(locale, page, params, options);
}

function splitUrl(path: string): { pathname: string; search: string; hash: string } {
  const url = new URL(path, "http://localhost");
  return { pathname: url.pathname, search: url.search, hash: url.hash };
}

/**
 * The same page in `locale`, keeping the query and hash, or `null` when `path` isn't a page.
 * Blog post slugs differ per language, so the server translates those (`app/.server/paths.ts`).
 */
export function translatePath(path: string, locale: Locale): string | null {
  const { pathname, search, hash } = splitUrl(path);
  const match = matchPage(pathname);
  return match ? pathForMatch(locale, match, { search, hash }) : null;
}

/**
 * Where a URL that isn't a page now lives (a `301`), keeping the query, or `null` for a 404:
 * - `/uk/…` → the Ukrainian URL, which has no prefix;
 * - the English-segment paths every page had before #84 (`/catalog/women`, `/products/…`,
 *   `/cart`) → their Ukrainian URL;
 * - `/en/` with Ukrainian segments (`/en/koshyk`) → the English URL.
 */
export function matchLegacyPath(path: string): string | null {
  const { pathname, search, hash } = splitUrl(path);
  const options = { search, hash };
  if (pathname === "/uk" || pathname.startsWith("/uk/")) {
    const rest = pathname.slice(3) || "/";
    const page = matchPage(rest);
    if (page && page.locale === DEFAULT_LOCALE) {
      return pathForMatch(DEFAULT_LOCALE, page, options);
    }
    return matchLegacyPath(appendSearchAndHash(rest, options));
  }
  const locale = localeFromPath(pathname);
  const rest = stripLocale(pathname, locale);
  if (locale === "en") {
    const match = matchPattern(rest, DEFAULT_LOCALE, (page) => PAGES[page].uk);
    return match ? pathForMatch("en", match, options) : null;
  }
  const match =
    matchPattern(rest, "en", (page) => PAGES[page].en) ??
    matchPattern(rest, "en", (page) => LEGACY_PATTERNS[page]);
  return match ? pathForMatch(DEFAULT_LOCALE, match, options) : null;
}

/**
 * An app path written by staff in Strapi (hero and offer buttons) in `locale`: a page in either
 * language or an old path becomes that page's URL in `locale`. Anything else is returned as is.
 */
export function localizeInternalPath(path: string, locale: Locale): string {
  const current = translatePath(path, locale);
  if (current !== null) {
    return current;
  }
  const legacy = matchLegacyPath(path);
  return (legacy === null ? null : translatePath(legacy, locale)) ?? path;
}

/** Each locale's route id for a page: route modules are shared, ids must be unique. */
export function pageRouteId(page: Page, locale: Locale): string {
  return `${page}.${locale}`;
}

/** The page and locale of a route id from `pageRouteId`, or `null` for other routes. */
export function parsePageRouteId(id: string): { page: Page; locale: Locale } | null {
  const [page, locale] = id.split(".");
  if (page === undefined || !(page in PAGES)) {
    return null;
  }
  const found = LOCALES.find((l) => l === locale);
  return found ? { page: page as Page, locale: found } : null;
}
