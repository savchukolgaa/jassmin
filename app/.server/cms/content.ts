import { z } from "zod";
import type {
  BlogPost,
  BlogPostSummary,
  CmsImage,
  HomePage,
  Paginated,
  Seo,
  SiteSettings,
} from "~/lib/cms";
import { getEnv } from "../env";
import { cmsFetch } from "./client";
import {
  type BlogPostEntry,
  type BlogPostSummaryEntry,
  blogPostEntry,
  blogPostSummaryEntry,
  collectionResponse,
  type HomePageEntry,
  homePageEntry,
  type PaginationMeta,
  type SiteSettingEntry,
  type StrapiMedia,
  singleResponse,
  siteSettingEntry,
} from "./schemas";

// Content queries for route loaders. They return app DTOs from `~/lib/cms`, never raw Strapi
// shapes, and throw `CmsError` when Strapi is unavailable (wrap calls with `cmsUnavailable`).

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

const listBlogPostsInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListBlogPostsInput = z.input<typeof listBlogPostsInput>;

/**
 * Builds an `srcset` from Strapi's resized formats and the original image, smallest first.
 * Returns `null` when no candidate has a known width.
 */
export function toSrcSet(media: StrapiMedia, baseUrl: string): string | null {
  const candidates = new Map<number, string>();
  for (const format of Object.values(media.formats ?? {})) {
    candidates.set(format.width, format.url);
  }
  if (media.width) {
    candidates.set(media.width, media.url);
  }
  if (candidates.size === 0) {
    return null;
  }
  return [...candidates]
    .sort(([a], [b]) => a - b)
    .map(([width, url]) => `${new URL(url, baseUrl).toString()} ${width}w`)
    .join(", ");
}

/** Resolves Strapi's relative `/uploads/…` URLs against the CMS origin. */
export function toImage(media: StrapiMedia | null | undefined, baseUrl: string): CmsImage | null {
  if (!media) {
    return null;
  }
  return {
    url: new URL(media.url, baseUrl).toString(),
    alt: media.alternativeText ?? "",
    width: media.width ?? null,
    height: media.height ?? null,
    srcSet: toSrcSet(media, baseUrl),
  };
}

export function toHomePage(entry: HomePageEntry, baseUrl: string): HomePage {
  const { hero, about, location } = entry;
  return {
    hero: {
      headline: hero.headline,
      ctaLabel: hero.ctaLabel,
      ctaHref: hero.ctaHref,
      image: toImage(hero.image, baseUrl),
    },
    about: { title: about.title, body: about.body },
    location: {
      address: location.address,
      openingHours: location.openingHours ?? null,
      mapEmbedUrl: location.mapEmbedUrl,
    },
  };
}

export function toSiteSettings(entry: SiteSettingEntry): SiteSettings {
  return {
    phone: entry.phone,
    email: entry.email,
    customerServiceHours: entry.customerServiceHours ?? null,
    legalName: entry.legalName?.trim() || null,
    socialLinks: (entry.socialLinks ?? []).map(({ platform, url }) => ({ platform, url })),
  };
}

export function toBlogPostSummary(entry: BlogPostSummaryEntry, baseUrl: string): BlogPostSummary {
  return {
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt ?? null,
    coverImage: toImage(entry.coverImage, baseUrl),
    authorName: entry.authorName ?? null,
    publishedAt: new Date(entry.publishedAt).toISOString(),
  };
}

export function toBlogPost(entry: BlogPostEntry, baseUrl: string): BlogPost {
  const seo: Seo | null = entry.seo
    ? {
        metaTitle: entry.seo.metaTitle ?? null,
        metaDescription: entry.seo.metaDescription ?? null,
        ogImage: toImage(entry.seo.ogImage, baseUrl),
      }
    : null;
  return { ...toBlogPostSummary(entry, baseUrl), content: entry.content, seo };
}

export function toPaginated<T>(items: T[], { page, pageSize, pageCount, total }: PaginationMeta) {
  return { items, page, pageSize, pageCount, total } satisfies Paginated<T>;
}

export async function getHomePage(): Promise<HomePage> {
  const { data } = await cmsFetch(
    "home-page",
    { populate: { hero: { populate: ["image"] }, about: true, location: true } },
    singleResponse(homePageEntry),
  );
  return toHomePage(data, getEnv().STRAPI_URL);
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const { data } = await cmsFetch(
    "site-setting",
    { populate: { socialLinks: true } },
    singleResponse(siteSettingEntry),
  );
  return toSiteSettings(data);
}

/** Published posts, newest first. */
export async function listBlogPosts(
  input: ListBlogPostsInput = {},
): Promise<Paginated<BlogPostSummary>> {
  const parsed = listBlogPostsInput.safeParse(input);
  if (!parsed.success) {
    throw new RangeError(`Invalid blog pagination: ${z.prettifyError(parsed.error)}`);
  }
  const { page, pageSize } = parsed.data;

  const { data, meta } = await cmsFetch(
    "blog-posts",
    {
      sort: ["publishedAt:desc"],
      pagination: { page, pageSize },
      populate: ["coverImage"],
    },
    collectionResponse(blogPostSummaryEntry),
  );
  const baseUrl = getEnv().STRAPI_URL;
  return toPaginated(
    data.map((entry) => toBlogPostSummary(entry, baseUrl)),
    meta.pagination,
  );
}

/** The published post with this slug, or `null` when there is none (a 404 for the route). */
export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  if (slug.trim() === "") {
    return null;
  }

  const { data } = await cmsFetch(
    "blog-posts",
    {
      filters: { slug: { $eq: slug } },
      pagination: { page: 1, pageSize: 1 },
      populate: { coverImage: true, seo: { populate: ["ogImage"] } },
    },
    collectionResponse(blogPostEntry),
  );
  const [entry] = data;
  return entry ? toBlogPost(entry, getEnv().STRAPI_URL) : null;
}
