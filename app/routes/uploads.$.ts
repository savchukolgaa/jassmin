import { proxyUpload } from "~/.server/cms/uploads-proxy";
import { getEnv } from "~/.server/env";
import type { Route } from "./+types/uploads.$";

// `/uploads/*` (#176): Strapi's media, fetched on the server from the internal `STRAPI_URL` and
// served from the shop's own origin, so browsers never talk to Strapi and the CSP's `img-src` is
// `'self'`. A resource route outside the shop layout: no session, visitor cookie or analytics.

export async function loader({ params, request }: Route.LoaderArgs) {
  return proxyUpload({ strapiUrl: getEnv().STRAPI_URL, path: params["*"], request });
}
