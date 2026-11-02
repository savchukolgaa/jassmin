// Blog URL contract and the view objects the blog routes render (#13). Built on the server by
// `app/.server/services/blog.ts` from the Strapi DTOs in `./cms`.
import type { CmsImage } from "./cms";
import type { Locale } from "./i18n";
import { pathFor } from "./paths";

export const BLOG_PAGE_SIZE = 12;

export interface BlogSearch {
  page: number;
}

/** Link to `page` of the blog list in `locale`, without `?page=` for the first page. */
export function blogHref(locale: Locale, page = 1): string {
  return pathFor(locale, "blog", {}, { search: page > 1 ? `page=${page}` : "" });
}

/** A post's URL in `locale`, with its slug in that locale (#84). */
export function blogPostHref(locale: Locale, slug: string): string {
  return pathFor(locale, "blogPost", { slug });
}

// Strapi UIDs only use these characters, so anything else can't be a post.
const BLOG_SLUG = /^[A-Za-z0-9._~-]{1,200}$/;

export function isBlogSlug(value: string | undefined): value is string {
  return value !== undefined && BLOG_SLUG.test(value);
}

/**
 * What blog HTML depends on besides the URL (which decides the locale, #84): the session (header),
 * and the `locale` cookie and `Accept-Language`, which decide the redirect to English and the
 * "View in English" hint.
 */
export const BLOG_VARY = "Cookie, Accept-Language";

/**
 * The blog routes' `headers` export: forwards the loader's cache headers, and stores nothing when
 * the loader threw (404, CMS 503), since those responses have no `Cache-Control` of their own.
 */
export function blogResponseHeaders(loaderHeaders: Headers): Headers {
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (!cacheControl) {
    return new Headers({ "Cache-Control": "no-store" });
  }
  return new Headers({
    "Cache-Control": cacheControl,
    Vary: loaderHeaders.get("Vary") ?? BLOG_VARY,
  });
}

export interface BlogPostCardView {
  /** The locale of the post's text; `uk` when its English translation was missing. */
  locale: Locale;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: CmsImage | null;
  /** ISO 8601 timestamp, for `<time dateTime>`. */
  publishedAt: string;
  /** Formatted on the server in the visitor's locale, e.g. "22 жовтня 2026 р.", so SSR and
   * hydration match. */
  publishedLabel: string;
}

export interface BlogListView {
  posts: BlogPostCardView[];
  page: number;
  pageCount: number;
  total: number;
}

export interface BlogPostView extends BlogPostCardView {
  /** ISO 8601 timestamp of the last edit; `publishedAt` when unknown (#86). */
  updatedAt: string;
  authorName: string | null;
  /** Sanitized HTML rendered from the Strapi Markdown; safe for `dangerouslySetInnerHTML`. */
  contentHtml: string;
  seo: {
    title: string;
    description: string;
    /** Absolute image URL for `og:image`, or `null`. */
    image: string | null;
  };
  /** The post's slug in each locale it's published in, for `hreflang` and the switcher. */
  alternates: Partial<Record<Locale, string>>;
}
