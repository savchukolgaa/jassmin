// Strapi's media URLs as the app serves them (#176): browsers never talk to Strapi for images. Its
// `/uploads/…` files are served from the shop's own origin by the `/uploads/*` proxy
// (`routes/uploads.$.ts`, `uploads-proxy.ts`), which fetches them from the internal `STRAPI_URL`.

const UPLOADS_PREFIX = "/uploads/";

/**
 * A Strapi media URL as a same-origin path: Strapi's relative `/uploads/…` URLs stay as they are,
 * and absolute ones whose path is under `/uploads/` lose their origin. Product rows synced before
 * #176 hold such absolute URLs (`http://localhost:1337/uploads/…`); only the Strapi sync writes
 * `products.image_url`, so those are always Strapi's files. Anything else (an external image) is
 * returned unchanged.
 */
export function toMediaPath(url: string): string {
  if (url.startsWith(UPLOADS_PREFIX)) {
    return url;
  }
  if (!/^https?:\/\//i.test(url)) {
    return url;
  }
  try {
    const { pathname, search } = new URL(url);
    return pathname.startsWith(UPLOADS_PREFIX) ? `${pathname}${search}` : url;
  } catch {
    return url;
  }
}

/**
 * A media URL from Strapi as the browser should load it: its uploads as same-origin `/uploads/…`
 * paths (served by the proxy), anything else resolved against `strapiUrl` as before.
 */
export function strapiMediaUrl(url: string, strapiUrl: string): string {
  const path = toMediaPath(url);
  if (path.startsWith(UPLOADS_PREFIX)) {
    return path;
  }
  return new URL(url, strapiUrl.endsWith("/") ? strapiUrl : `${strapiUrl}/`).toString();
}
