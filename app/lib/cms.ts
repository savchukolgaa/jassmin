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
  };
  about: {
    title: string;
    /** Markdown. */
    body: string;
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
