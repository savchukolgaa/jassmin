import { z } from "zod";
import { OFFER_KINDS, SOCIAL_PLATFORMS } from "~/lib/cms";

// zod schemas for Strapi v5 REST responses (flat entries with `documentId`, no `attributes`).
// Unknown keys are stripped, so Strapi adding fields doesn't break the app; missing or
// mistyped fields do, and surface as a `CmsError` of kind `invalid_response`.

/** One of the resized variants Strapi generates for an uploaded image (`small`, `medium`, …). */
export const strapiMediaFormat = z.object({
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const strapiMedia = z.object({
  url: z.string().min(1),
  alternativeText: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  formats: z.record(z.string(), strapiMediaFormat).nullish(),
});

export const seoComponent = z.object({
  metaTitle: z.string().nullish(),
  metaDescription: z.string().nullish(),
  ogImage: strapiMedia.nullish(),
});

export const heroComponent = z.object({
  headline: z.string(),
  ctaLabel: z.string(),
  ctaHref: z.string(),
  /** This language's photo; it replaces the home page's shared `heroImage` (#80). */
  imageLocalized: strapiMedia.nullish(),
  imageAlt: z.string().nullish(),
  eyebrow: z.string().nullish(),
  subtitle: z.string().nullish(),
  secondaryCtaLabel: z.string().nullish(),
  secondaryCtaHref: z.string().nullish(),
});

export const aboutComponent = z.object({
  title: z.string(),
  body: z.string(),
  /** This language's photo; it replaces the home page's shared `aboutImage` (#80). */
  imageLocalized: strapiMedia.nullish(),
  imageAlt: z.string().nullish(),
});

/**
 * A coordinate within `[-limit, limit]`. Strapi may send decimals as numbers or strings; anything
 * else, or a value out of range, becomes `null` rather than failing the page (#86).
 */
const coordinate = (limit: number) =>
  z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
      z.number().min(-limit).max(limit).nullish(),
    )
    .catch(null);

export const locationComponent = z.object({
  address: z.string(),
  openingHours: z.string().nullish(),
  mapEmbedUrl: z.string(),
  /** Optional structured address and coordinates, used only in the store's JSON-LD (#86). */
  streetAddress: z.string().nullish(),
  addressLocality: z.string().nullish(),
  postalCode: z.string().nullish(),
  latitude: coordinate(90),
  longitude: coordinate(180),
});

export const socialLinkComponent = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z.string(),
});

export const homePageEntry = z.object({
  documentId: z.string(),
  /** The locale Strapi served the entry in (`uk`, `en`). */
  locale: z.string().nullish(),
  /** Shared by every locale (#80); the components hold the per-language overrides. */
  heroImage: strapiMedia.nullish(),
  aboutImage: strapiMedia.nullish(),
  hero: heroComponent,
  about: aboutComponent,
  location: locationComponent,
});

export const siteSettingEntry = z.object({
  documentId: z.string(),
  /** The locale Strapi served the entry in (`uk`, `en`). */
  locale: z.string().nullish(),
  phone: z.string(),
  email: z.string(),
  customerServiceHours: z.string().nullish(),
  legalName: z.string().nullish(),
  socialLinks: z.array(socialLinkComponent).nullish(),
});

export const blogPostSummaryEntry = z.object({
  documentId: z.string(),
  /** The locale Strapi served the entry in (`uk`, `en`). */
  locale: z.string().nullish(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullish(),
  authorName: z.string().nullish(),
  // Only published entries are requested, so `publishedAt` is always set.
  publishedAt: z.iso.datetime({ offset: true }),
  coverImage: strapiMedia.nullish(),
  coverImageLocalized: strapiMedia.nullish(),
  coverImageAlt: z.string().nullish(),
});

export const blogPostEntry = blogPostSummaryEntry.extend({
  /** The last edit, for `BlogPosting.dateModified` (#86). */
  updatedAt: z.iso.datetime({ offset: true }).nullish(),
  content: z.string(),
  seo: seoComponent.nullish(),
});

export const offerProductRef = z.object({
  publicId: z.string(),
});

export const offerEntry = z.object({
  documentId: z.string(),
  /** The locale Strapi served the entry in (`uk`, `en`). */
  locale: z.string().nullish(),
  title: z.string(),
  slug: z.string(),
  kind: z.enum(OFFER_KINDS),
  summary: z.string().nullish(),
  body: z.string().nullish(),
  image: strapiMedia.nullish(),
  imageLocalized: strapiMedia.nullish(),
  imageAlt: z.string().nullish(),
  // Strapi `datetime` fields; an offset is required so the instant is never ambiguous.
  startsAt: z.iso.datetime({ offset: true }).nullish(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
  priceNote: z.string().nullish(),
  products: z.array(offerProductRef).nullish(),
  ctaLabel: z.string().nullish(),
  ctaUrl: z.string().nullish(),
  sortOrder: z.number().int().nullish(),
});

export const paginationMeta = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export function singleResponse<T extends z.ZodType>(entry: T) {
  return z.object({ data: entry });
}

export function collectionResponse<T extends z.ZodType>(entry: T) {
  return z.object({
    data: z.array(entry),
    meta: z.object({ pagination: paginationMeta }),
  });
}

export type StrapiMedia = z.infer<typeof strapiMedia>;
export type HomePageEntry = z.infer<typeof homePageEntry>;
export type SiteSettingEntry = z.infer<typeof siteSettingEntry>;
export type BlogPostSummaryEntry = z.infer<typeof blogPostSummaryEntry>;
export type BlogPostEntry = z.infer<typeof blogPostEntry>;
export type OfferEntry = z.infer<typeof offerEntry>;
export type PaginationMeta = z.infer<typeof paginationMeta>;
