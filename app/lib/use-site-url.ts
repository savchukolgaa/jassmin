import { useMatches } from "react-router";
import { seoSite } from "./seo";

/**
 * The site's public origin (`PUBLIC_SITE_URL`, #85) from the root loader, for absolute URLs in
 * components such as the JSON-LD (#86). `""` when the root loader failed.
 */
export function useSiteUrl(): string {
  return seoSite(useMatches()).url;
}
