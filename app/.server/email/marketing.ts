// What every marketing email shares (#139, #181): the unsubscribe link and its one-click headers
// (RFC 2369 and RFC 8058), product photos as absolute URLs, and UTM tags on links to the shop.
// The cart reminder (`services/cart-reminder-email.ts`) and the newsletter
// (`services/newsletter-email.ts`) both build on it.
import type { Locale } from "~/lib/i18n/locales";
import { pathFor } from "~/lib/paths";
import { toMediaPath } from "../cms/media";

/** The stand-in photo for a product without its own: the shop's bottle, a stable public file. */
export const EMAIL_BOTTLE_PHOTO_PATH = "/email/shop-bottle.jpg";

/** The user's unsubscribe page in `locale`, also the `List-Unsubscribe` target. */
export function unsubscribeUrl(siteUrl: string, locale: Locale, token: string): string {
  return `${siteUrl}${pathFor(locale, "unsubscribe", { token })}`;
}

/** The headers that give mail clients a one-click unsubscribe button (RFC 2369 and RFC 8058). */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * A product's photo: its own when it has one, else the shop's bottle. Strapi's uploads are served
 * from the shop's origin (#176), so a stored `/uploads/…` path (or an older absolute Strapi URL)
 * becomes an absolute URL on the site; other absolute web URLs are used as they are.
 */
export function photoOf(imageUrl: string | null, siteUrl: string): string {
  if (!imageUrl) {
    return `${siteUrl}${EMAIL_BOTTLE_PHOTO_PATH}`;
  }
  const path = toMediaPath(imageUrl);
  if (path.startsWith("/uploads/")) {
    return `${siteUrl}${path}`;
  }
  return /^https?:\/\//i.test(path) ? path : `${siteUrl}${EMAIL_BOTTLE_PHOTO_PATH}`;
}

/**
 * `href` with the `utm` tags when it leads to the shop: a path (`/catalog/women`) or an absolute
 * URL on `siteUrl`'s origin. Its own `utm_*` parameters are replaced, everything else is kept.
 * Links elsewhere (other sites, `mailto:`, `tel:`) come back unchanged, and so does anything that
 * isn't a URL. A shop path comes back absolute, since an email has no base URL.
 */
export function withUtm(href: string, siteUrl: string, utm: Record<string, string>): string {
  const trimmed = href.trim();
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return href;
  }
  const isPath = trimmed.startsWith("/") && !trimmed.startsWith("//");
  if (!isPath && !/^https?:\/\//i.test(trimmed)) {
    return href;
  }
  let url: URL;
  try {
    url = new URL(trimmed, site);
  } catch {
    return href;
  }
  if (url.origin !== site.origin) {
    return href;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  for (const [key, value] of Object.entries(utm)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
