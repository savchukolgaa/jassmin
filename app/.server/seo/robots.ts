import { EN_PREFIX, PAGES, type Page } from "~/lib/paths";

// Builds `/robots.txt` (#87).

/**
 * The private pages: cart, checkout (with its success and payment pages), login, register, the
 * password reset and email verification pages (#135), the account (with its orders and profile),
 * and a gift card's result page (#125). Each one's path is a prefix of its sub-pages' paths, so
 * these cover every page that isn't indexable; a test checks that.
 */
export const ROBOTS_PRIVATE_PAGES = [
  "cart",
  "checkout",
  "login",
  "register",
  "forgotPassword",
  "resetPassword",
  "verifyEmail",
  "account",
  // The gift card purchase page is indexable, so only its result pages are blocked (#125).
  "giftCardSuccess",
] as const satisfies readonly Page[];

/**
 * Every path to block for `page`: its Ukrainian and English URL, and its path from before #84 (the
 * English pattern without `/en`, e.g. `/cart`), which only 301s but shouldn't be crawled either.
 */
function privatePaths(page: Page): string[] {
  // A page with parameters is blocked from its static prefix: `…/uspikh/:giftCardId` → `…/uspikh`.
  const prefix = (pattern: string) => pattern.replace(/\/:.*$/, "");
  const uk = prefix(PAGES[page].uk);
  const en = prefix(PAGES[page].en);
  return [`/${uk}`, `${EN_PREFIX}/${en}`, `/${en}`];
}

/** The `Disallow` paths of a production `robots.txt`: private pages, then system paths. */
export function robotsDisallowPaths(): string[] {
  return [...ROBOTS_PRIVATE_PAGES.flatMap(privatePaths), ...ROBOTS_SYSTEM_PATHS];
}

/**
 * Untranslated paths that serve no page worth indexing: action-only routes and the CMS and
 * payment endpoints. The trailing slash on the API prefixes keeps similarly named pages crawlable.
 */
export const ROBOTS_SYSTEM_PATHS = [
  "/api/",
  "/cms/",
  "/payments/",
  "/locale",
  "/consent",
  "/logout",
] as const;

export interface RobotsOptions {
  /** The public origin, e.g. `https://jassmin.ua`, for the `Sitemap:` line. */
  siteUrl: string;
  /** Block the whole site: outside production, and on staging servers (`ROBOTS_DISALLOW_ALL`). */
  disallowAll: boolean;
  /** Path prefixes to block, e.g. `/koshyk` and `/en/cart`; ignored with `disallowAll`. */
  disallow: readonly string[];
}

/** The `robots.txt` body: one group for every crawler, then the sitemap URL. */
export function buildRobotsTxt({ siteUrl, disallowAll, disallow }: RobotsOptions): string {
  const rules = disallowAll ? ["/"] : [...new Set(disallow)];
  return [
    "User-agent: *",
    ...rules.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${siteUrl.replace(/\/+$/, "")}/sitemap.xml`,
    "",
  ].join("\n");
}
