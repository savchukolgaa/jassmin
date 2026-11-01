import { getEnv, getSiteUrl } from "~/.server/env";
import { getSitemap } from "~/.server/services/sitemap";
import type { Route } from "./+types/sitemap.xml";

// `/sitemap.xml` (#87): every indexable page in both languages, with `hreflang` alternates. A
// resource route outside the shop layout, so no session, visitor cookie or analytics run for it.

/** An hour; 5 minutes when Strapi was down, so the posts come back soon. */
export const SITEMAP_MAX_AGE = 3600;
export const PARTIAL_SITEMAP_MAX_AGE = 300;

export async function loader({ request }: Route.LoaderArgs) {
  const { xml, complete } = await getSitemap(getSiteUrl(getEnv(), request));
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=${complete ? SITEMAP_MAX_AGE : PARTIAL_SITEMAP_MAX_AGE}`,
    },
  });
}
