import { getEnv, getSiteUrl } from "~/.server/env";
import { buildRobotsTxt, robotsDisallowPaths } from "~/.server/seo/robots";
import type { Route } from "./+types/robots.txt";

// `/robots.txt` (#87): blocks private and action-only paths and points to the sitemap. Outside
// production, or with `ROBOTS_DISALLOW_ALL`, it blocks everything so previews aren't indexed.

export function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const body = buildRobotsTxt({
    siteUrl: getSiteUrl(env, request),
    disallowAll: env.NODE_ENV !== "production" || env.ROBOTS_DISALLOW_ALL === true,
    disallow: robotsDisallowPaths(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
