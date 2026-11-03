// Social profile links from Strapi site settings (#101), cleaned for rendering. Isomorphic: no
// server imports and no zod, so components may import it.

import type { SocialLink, SocialPlatform } from "./cms";

/** Display order: Instagram and Telegram first (#101), then the other platforms. */
export const SOCIAL_ORDER: readonly SocialPlatform[] = [
  "instagram",
  "telegram",
  "facebook",
  "tiktok",
  "viber",
  "youtube",
];

/** Share-tracking query parameters the platforms append when a profile link is copied. */
const TRACKING_PARAMS = new Set(["xtok", "igsh", "igshid", "si", "fbclid", "gclid"]);

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.has(key) || key.startsWith("utm_");
}

/**
 * The profile URL without tracking parameters (`xtok`, `igsh`, `utm_*`, …), or `null` when it
 * isn't an absolute `https:` URL.
 */
export function cleanSocialUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) {
      url.searchParams.delete(name);
    }
  }
  // `URLSearchParams` leaves a bare `?` behind once every parameter is gone.
  if (url.searchParams.size === 0) {
    url.search = "";
  }
  return url.toString();
}

/** Cleans every link, drops invalid ones and duplicates, and sorts them by `SOCIAL_ORDER`. */
export function normalizeSocialLinks(links: readonly SocialLink[]): SocialLink[] {
  const seen = new Set<string>();
  const cleaned: SocialLink[] = [];
  for (const { platform, url } of links) {
    const clean = cleanSocialUrl(url);
    const key = `${platform} ${clean}`;
    if (clean !== null && !seen.has(key)) {
      seen.add(key);
      cleaned.push({ platform, url: clean });
    }
  }
  // `sort` is stable, so links of the same platform keep the editor's order.
  return cleaned.sort(
    (a, b) => SOCIAL_ORDER.indexOf(a.platform) - SOCIAL_ORDER.indexOf(b.platform),
  );
}
