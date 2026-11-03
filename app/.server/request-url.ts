/**
 * The URL of the page `request` is for (#112). On a client-side navigation React Router v8 fetches
 * the page's data from `/<path>.data?_routes=…` (`/_.data` for `/`) and passes loaders, actions
 * and middleware that raw request; only their `url` argument is normalized. Mirrors React Router's
 * `getNormalizedPath`: drops the `.data` suffix and the `_routes` param, and keeps the origin,
 * `index` and every other param.
 *
 * Use it for anything that reads the request's *path* (its locale, the page it matches, a
 * `redirectTo` back to it). Reading search params or the origin from `request.url` is fine: a data
 * request only adds `_routes`, which nothing reads.
 */
export function pageUrl(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/_.data")) {
    url.pathname = url.pathname.slice(0, -"_.data".length);
  } else if (url.pathname.endsWith(".data")) {
    url.pathname = url.pathname.slice(0, -".data".length);
  }
  // Only when present: deleting re-serializes the query (`?index` → `?index=`).
  if (url.searchParams.has("_routes")) {
    url.searchParams.delete("_routes");
  }
  return url;
}
