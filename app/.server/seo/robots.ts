// Builds `/robots.txt` (#87).

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
