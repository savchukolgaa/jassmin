// App-level DTOs for editorial content managed in Strapi (see app/.server/cms/content.ts).
// Plain data only, so loaders can return them and both server and client code can import them.

import type { Locale } from "./i18n/locales";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "telegram",
  "viber",
  "youtube",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface CmsImage {
  /** Absolute URL, ready for `<img src>`. */
  url: string;
  /** Alternative text; empty string when the editor left it blank. */
  alt: string;
  width: number | null;
  height: number | null;
  /** `srcset` built from Strapi's resized formats plus the original; `null` when there are none. */
  srcSet: string | null;
}

export interface Seo {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: CmsImage | null;
}

export interface HomePage {
  /** The locale the content was served in: `uk` when an English translation was missing. */
  locale: Locale;
  hero: {
    headline: string;
    ctaLabel: string;
    ctaHref: string;
    image: CmsImage | null;
    /** The small pill above the headline, e.g. "Tester set"; `null` when blank. */
    eyebrow: string | null;
    subtitle: string | null;
    /** The second hero button; `null` unless both its label and link are filled in. */
    secondaryCta: { label: string; href: string } | null;
  };
  about: {
    title: string;
    /** Markdown. */
    body: string;
    /** The store photo beside the text. */
    image: CmsImage | null;
  };
  location: {
    address: string;
    openingHours: string | null;
    mapEmbedUrl: string;
  };
}

/** Display names for social platforms, e.g. on the home page Contacts section. */
export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  telegram: "Telegram",
  viber: "Viber",
  youtube: "YouTube",
};

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

export interface SiteSettings {
  /** The locale the content was served in: `uk` when an English translation was missing. */
  locale: Locale;
  phone: string;
  email: string;
  customerServiceHours: string | null;
  /** The sole proprietor (ФОП) responsible for personal data, named on the privacy page (#18). */
  legalName: string | null;
  socialLinks: SocialLink[];
}

export interface BlogPostSummary {
  /** The locale the content was served in: `uk` when an English translation was missing. */
  locale: Locale;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: CmsImage | null;
  authorName: string | null;
  /** ISO 8601 timestamp. */
  publishedAt: string;
}

export interface BlogPost extends BlogPostSummary {
  /** Markdown; render and sanitize it before showing it. */
  content: string;
  seo: Seo | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

/** Kinds of special offer on /offers (#55); `perk` offers form the perks strip, not cards. */
export const OFFER_KINDS = [
  "discovery-set",
  "seasonal",
  "gift",
  "bundle",
  "featured",
  "last-units",
  "perk",
] as const;

export type OfferKind = (typeof OFFER_KINDS)[number];

export interface Offer {
  /** The locale the content was served in: `uk` when an English translation was missing. */
  locale: Locale;
  documentId: string;
  slug: string;
  kind: OfferKind;
  title: string;
  summary: string | null;
  /** Markdown; render and sanitize it before showing it. */
  body: string | null;
  image: CmsImage | null;
  /** UTC ISO 8601 timestamp; `null` when the offer has no start (it's already running). */
  startsAt: string | null;
  /** UTC ISO 8601 timestamp, exclusive; `null` when the offer doesn't end. */
  endsAt: string | null;
  /** Editorial price text such as "3 × 7 мл — 499 ₴"; checkout doesn't apply it. */
  priceNote: string | null;
  /** `public_id`s of shop products (UUIDs), in the editor's order, without duplicates. */
  productIds: string[];
  ctaLabel: string | null;
  /** As entered in Strapi; make it safe with `toInternalPath` before linking. */
  ctaUrl: string | null;
  /** Lowest first; the lowest active non-perk offer is the page's hero. */
  sortOrder: number;
}
