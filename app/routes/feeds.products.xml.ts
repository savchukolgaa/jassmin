import { getEnv, getSiteUrl } from "~/.server/env";
import { getProductFeed } from "~/.server/services/product-feed";
import type { Locale } from "~/lib/i18n";
import { EN_PREFIX } from "~/lib/paths";
import type { Route } from "./+types/feeds.products.xml";

// `/feeds/products.xml` and `/en/feeds/products.xml` (#140): every perfume size on sale for
// Google Merchant Center and Meta Commerce Manager (see `docs/product-feeds.md`). A resource route
// outside the shop layout, so no session, visitor cookie or analytics run for it. The language
// comes from the path only, so each URL always serves the same feed.

/** Prices and stock in the feed are at most an hour old. */
export const FEED_MAX_AGE = 3600;

/** The feed's language: English under `/en/`, else Ukrainian. */
export function feedLocale(request: Request): Locale {
  return new URL(request.url).pathname.startsWith(`${EN_PREFIX}/`) ? "en" : "uk";
}

export async function loader({ request }: Route.LoaderArgs) {
  // Read before streaming, so a database error is still a plain 500.
  const chunks = await getProductFeed({
    locale: feedLocale(request),
    siteUrl: getSiteUrl(getEnv(), request),
  });
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.iterator]();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next.value));
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=${FEED_MAX_AGE}`,
      // Fetched by Google and Meta, but not a page for search results. Not `Disallow`ed in
      // robots.txt: Merchant Center's scheduled fetch respects it.
      "X-Robots-Tag": "noindex",
    },
  });
}
