import type { SocialLink } from "~/lib/cms";
import type { Locale } from "~/lib/i18n";
import { getSiteSettings } from "./content";
import { isCmsError } from "./errors";

/** How long the links are reused: a link staff add in Strapi shows within a minute (#101). */
export const SOCIAL_LINKS_TTL_MS = 60_000;
/** After a failed read, wait this long before asking Strapi again. */
export const SOCIAL_LINKS_RETRY_MS = 10_000;

interface CacheEntry {
  /** The last links read successfully; `[]` until the first success. */
  value: SocialLink[];
  expiresAt: number;
  pending: Promise<SocialLink[]> | null;
}

const cache = new Map<Locale, CacheEntry>();

/** Forgets every cached read. For tests. */
export function resetSocialLinksCache(): void {
  cache.clear();
}

async function refresh(locale: Locale, entry: CacheEntry): Promise<SocialLink[]> {
  try {
    const { socialLinks } = await getSiteSettings(locale);
    entry.value = socialLinks;
    entry.expiresAt = Date.now() + SOCIAL_LINKS_TTL_MS;
  } catch (error) {
    // Footer links are never worth failing a page over, so even an unexpected error is only logged.
    if (isCmsError(error)) {
      console.warn(`[cms] social links unavailable (${error.kind}): ${error.message}`);
    } else {
      console.error("[cms] reading social links failed", error);
    }
    entry.expiresAt = Date.now() + SOCIAL_LINKS_RETRY_MS;
  } finally {
    entry.pending = null;
  }
  return entry.value;
}

/**
 * The store's social links for the `_shop` layout's footer and mobile menu, which every page
 * shows. Strapi is asked at most once a minute per locale, and concurrent requests share one read.
 * When Strapi is down this returns the last links it had, or `[]`, so pages never fail over them.
 */
export async function getSocialLinks(locale: Locale): Promise<SocialLink[]> {
  let entry = cache.get(locale);
  if (!entry) {
    entry = { value: [], expiresAt: 0, pending: null };
    cache.set(locale, entry);
  }
  if (entry.pending) {
    return entry.pending;
  }
  if (Date.now() < entry.expiresAt) {
    return entry.value;
  }
  entry.pending = refresh(locale, entry);
  return entry.pending;
}
