// Turns editor-controlled values from Strapi into safe link targets. Isomorphic: no server imports.

/** Where the hero CTA goes when Strapi holds an unusable `ctaHref`. */
export const FALLBACK_CTA_PATH = "/popular";

export type CtaTarget = { kind: "internal"; to: string } | { kind: "external"; href: string };

/**
 * App paths (`/popular`) become router links, `https:` URLs plain links. Anything else
 * (`javascript:`, protocol-relative `//host`, garbage) falls back to `FALLBACK_CTA_PATH`.
 */
export function resolveCtaHref(href: string): CtaTarget {
  const value = href.trim();
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return { kind: "internal", to: value };
  }
  if (URL.canParse(value) && new URL(value).protocol === "https:") {
    return { kind: "external", href: value };
  }
  return { kind: "internal", to: FALLBACK_CTA_PATH };
}

const MAP_EMBED_HOSTS = new Set(["www.google.com", "maps.google.com"]);

/** The map embed URL when it's an `https:` Google Maps URL, otherwise `null` (no iframe). */
export function safeMapEmbedUrl(url: string): string | null {
  if (!URL.canParse(url.trim())) {
    return null;
  }
  const parsed = new URL(url.trim());
  const isGoogleMaps =
    parsed.protocol === "https:" &&
    MAP_EMBED_HOSTS.has(parsed.hostname) &&
    (parsed.pathname === "/maps" || parsed.pathname.startsWith("/maps/"));
  return isGoogleMaps ? parsed.toString() : null;
}

/** `tel:` link for a human-formatted phone number, e.g. `+380 44 123 45 67` → `tel:+380441234567`. */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${phone.replace(/\D/g, "")}`;
}

/** Google Maps directions/search link for an address. */
export function directionsUrl(address: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", address.trim());
  return url.toString();
}
