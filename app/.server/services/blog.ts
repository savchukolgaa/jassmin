import {
  type BlogListView,
  type BlogPostCardView,
  type BlogPostView,
  blogPostHref,
  DEFAULT_BLOG_DESCRIPTION,
} from "~/lib/blog";
import type { BlogPost, BlogPostSummary, Paginated } from "~/lib/cms";
import { renderArticleMarkdown, toPlainText } from "../markdown";
import { hasSessionCookie } from "../session-cookie";

// Prepares Strapi blog posts for the `/blog` and `/blog/:slug` routes (#13).

const PUBLISHED_DATE = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "Europe/Kyiv",
});

/** "22 October 2026", in shop time so the date doesn't depend on the server's time zone. */
export function formatPublishedDate(iso: string): string {
  return PUBLISHED_DATE.format(new Date(iso));
}

function toCardView(post: BlogPostSummary): BlogPostCardView {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImage: post.coverImage,
    publishedAt: post.publishedAt,
    publishedLabel: formatPublishedDate(post.publishedAt),
  };
}

export function buildBlogListView({
  items,
  page,
  pageCount,
  total,
}: Paginated<BlogPostSummary>): BlogListView {
  return { posts: items.map(toCardView), page, pageCount, total };
}

export function buildBlogPostView(
  post: BlogPost,
  { origin, mediaBaseUrl }: { origin: string; mediaBaseUrl: string },
): BlogPostView {
  const seo = post.seo;
  return {
    ...toCardView(post),
    authorName: post.authorName,
    contentHtml: renderArticleMarkdown(post.content, { mediaBaseUrl }),
    seo: {
      title: seo?.metaTitle || post.title,
      description:
        seo?.metaDescription ||
        post.excerpt ||
        toPlainText(post.content) ||
        DEFAULT_BLOG_DESCRIPTION,
      image: seo?.ogImage?.url ?? post.coverImage?.url ?? null,
      canonicalUrl: new URL(blogPostHref(post.slug), origin).toString(),
    },
  };
}

/**
 * Cache headers for blog pages. The HTML includes the visitor's header (login state, cart count),
 * so only responses for visitors without a session or visitor cookie may be stored by shared
 * caches.
 */
export function blogCacheHeaders(request: Request): Headers {
  return new Headers({
    "Cache-Control": hasSessionCookie(request)
      ? "private, no-cache"
      : "public, max-age=60, stale-while-revalidate=300",
    Vary: "Cookie",
  });
}
