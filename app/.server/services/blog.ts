import { BLOG_VARY, type BlogListView, type BlogPostCardView, type BlogPostView } from "~/lib/blog";
import type { BlogPost, BlogPostSummary, Paginated } from "~/lib/cms";
import { createTranslator, DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import { renderArticleMarkdown, toPlainText } from "../markdown";
import { hasSessionCookie } from "../session-cookie";

// Prepares Strapi blog posts for the `/blog` and `/blog/:slug` routes (#13).

/**
 * "22 жовтня 2026 р." / "22 October 2026", in shop time so the date doesn't depend on the
 * server's time zone.
 */
export function formatPublishedDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return createTranslator(locale).formatDate(iso);
}

function toCardView(post: BlogPostSummary, locale: Locale): BlogPostCardView {
  return {
    locale: post.locale,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImage: post.coverImage,
    publishedAt: post.publishedAt,
    publishedLabel: formatPublishedDate(post.publishedAt, locale),
  };
}

export function buildBlogListView(
  { items, page, pageCount, total }: Paginated<BlogPostSummary>,
  locale: Locale = DEFAULT_LOCALE,
): BlogListView {
  return { posts: items.map((item) => toCardView(item, locale)), page, pageCount, total };
}

export function buildBlogPostView(
  post: BlogPost,
  { mediaBaseUrl, locale = DEFAULT_LOCALE }: { mediaBaseUrl: string; locale?: Locale },
): BlogPostView {
  const seo = post.seo;
  return {
    ...toCardView(post, locale),
    authorName: post.authorName,
    contentHtml: renderArticleMarkdown(post.content, { mediaBaseUrl }),
    seo: {
      title: seo?.metaTitle || post.title,
      description:
        seo?.metaDescription ||
        post.excerpt ||
        toPlainText(post.content) ||
        createTranslator(locale).t("blog.defaultDescription"),
      image: seo?.ogImage?.url ?? post.coverImage?.url ?? null,
    },
  };
}

/**
 * Cache headers for blog pages. The HTML includes the visitor's header (login state, cart count),
 * so only responses for visitors without a session or visitor cookie may be stored by shared
 * caches. It is also in the visitor's locale, so caches must key on the locale's sources too
 * (`BLOG_VARY`).
 */
export function blogCacheHeaders(request: Request): Headers {
  return new Headers({
    "Cache-Control": hasSessionCookie(request)
      ? "private, no-cache"
      : "public, max-age=60, stale-while-revalidate=300",
    Vary: BLOG_VARY,
  });
}
