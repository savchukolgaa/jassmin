// The newsletter (#181): staff write it in Strapi (uk and en), send a test to themselves, then
// send it once to every customer who agreed to marketing email. The app queues one delivery per
// customer and `pnpm db:send-newsletters` sends them within the daily limit. Isomorphic: no zod
// (that's `newsletter.schema.ts`) and no server imports.
import type { NewsletterStatus } from "./enums";

/** Featured products a newsletter shows as cards, at most. */
export const NEWSLETTER_MAX_PRODUCTS = 4;

/** A new newsletter is refused within this many days of the previous one ("at most once a week"). */
export const NEWSLETTER_INTERVAL_DAYS = 7;

/** Tries per delivery before it is `failed`. */
export const NEWSLETTER_MAX_ATTEMPTS = 3;

/** Minutes until a delivery whose send failed is tried again, by attempt; the last repeats. */
export const NEWSLETTER_RETRY_DELAYS_MINUTES = [15, 60] as const;

/** Longest slug, which becomes `utm_campaign`. */
export const NEWSLETTER_SLUG_MAX = 80;

/** Lowercase words joined by single hyphens, like Strapi's `uid` fields. */
export const NEWSLETTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const NEWSLETTER_SUBJECT_MAX = 150;
export const NEWSLETTER_PREHEADER_MAX = 200;
export const NEWSLETTER_BODY_MAX = 20_000;

/** One language's text of a newsletter; the body is Markdown (Strapi's rich text). */
export interface NewsletterText {
  subject: string;
  preheader: string | null;
  body: string;
}

/** What staff wrote: Ukrainian always, English optional (English customers get uk without it). */
export interface NewsletterContent {
  slug: string;
  uk: NewsletterText;
  en: NewsletterText | null;
  /** Featured products by `public_id`, in the order staff picked them. */
  productPublicIds: string[];
}

/** How a newsletter's deliveries stand. `queued` counts every delivery, whatever its status. */
export interface NewsletterCounts {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** The newsletter as Strapi shows it after a send (and after every push of the counts). */
export interface NewsletterState {
  status: NewsletterStatus;
  counts: NewsletterCounts;
  /** When "send" was pressed, as ISO 8601. */
  sentAt: string;
}

/** The UTM tags of every shop link in a newsletter, so its visits count for its campaign. */
export function newsletterUtm(slug: string) {
  return { utm_source: "newsletter", utm_medium: "email", utm_campaign: slug } as const;
}
