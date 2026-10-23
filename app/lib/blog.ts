// Blog URL contract and the view objects the blog routes render (#13). Built on the server by
// `app/.server/services/blog.ts` from the Strapi DTOs in `./cms`.
import { z } from "zod";
import type { CmsImage } from "./cms";

export const BLOG_PAGE_SIZE = 12;

/** Meta description for the blog list, and for articles without an excerpt or text. */
export const DEFAULT_BLOG_DESCRIPTION =
  "Fragrance articles and scent guides from Jassmin: how to choose, wear and care for perfume.";

const blogSearchSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export interface BlogSearch {
  page: number;
}

/** Reads `?page=` from the blog list URL; bad values fall back to page 1. */
export function parseBlogSearch(params: URLSearchParams): BlogSearch {
  return blogSearchSchema.parse({ page: params.get("page") ?? undefined });
}

/** Link to `page` of the blog list, without `?page=` for the first page. */
export function blogHref(page: number): string {
  return page > 1 ? `/blog?page=${page}` : "/blog";
}

export function blogPostHref(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

// Strapi UIDs only use these characters, so anything else can't be a post.
const BLOG_SLUG = /^[A-Za-z0-9._~-]{1,200}$/;

export function isBlogSlug(value: string | undefined): value is string {
  return value !== undefined && BLOG_SLUG.test(value);
}

export interface BlogPostCardView {
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: CmsImage | null;
  /** ISO 8601 timestamp, for `<time dateTime>`. */
  publishedAt: string;
  /** Formatted on the server, e.g. "22 October 2026", so SSR and hydration match. */
  publishedLabel: string;
}

export interface BlogListView {
  posts: BlogPostCardView[];
  page: number;
  pageCount: number;
  total: number;
}

export interface BlogPostView extends BlogPostCardView {
  authorName: string | null;
  /** Sanitized HTML rendered from the Strapi Markdown; safe for `dangerouslySetInnerHTML`. */
  contentHtml: string;
  seo: {
    title: string;
    description: string;
    /** Absolute image URL for `og:image`, or `null`. */
    image: string | null;
    canonicalUrl: string;
  };
}
