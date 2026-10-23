import { describe, expect, it } from "vitest";
import { DEFAULT_BLOG_DESCRIPTION } from "~/lib/blog";
import type { BlogPost } from "~/lib/cms";
import blogPostBySlug from "../cms/__fixtures__/blog-post-by-slug.json";
import blogPosts from "../cms/__fixtures__/blog-posts.json";
import { toBlogPost, toBlogPostSummary, toPaginated } from "../cms/content";
import { blogPostEntry, blogPostSummaryEntry, collectionResponse } from "../cms/schemas";
import {
  blogCacheHeaders,
  buildBlogListView,
  buildBlogPostView,
  formatPublishedDate,
} from "./blog";

const CMS = "http://cms.test";
const SITE = { origin: "https://jassmin.ua", mediaBaseUrl: CMS };

function fixturePost(): BlogPost {
  const [entry] = collectionResponse(blogPostEntry).parse(blogPostBySlug).data;
  if (!entry) throw new Error("fixture has no post");
  return toBlogPost(entry, CMS);
}

describe("formatPublishedDate", () => {
  it("formats in Kyiv time", () => {
    expect(formatPublishedDate("2026-10-22T19:06:58.498Z")).toBe("22 October 2026");
    // 22:30 UTC is already the next day in Kyiv.
    expect(formatPublishedDate("2026-10-22T22:30:00.000Z")).toBe("23 October 2026");
  });
});

describe("buildBlogListView", () => {
  it("keeps the CMS order and pagination and adds date labels", () => {
    const { data, meta } = collectionResponse(blogPostSummaryEntry).parse(blogPosts);
    const view = buildBlogListView(
      toPaginated(
        data.map((entry) => toBlogPostSummary(entry, CMS)),
        meta.pagination,
      ),
    );

    expect(view.posts.map((post) => post.slug)).toEqual(data.map((entry) => entry.slug));
    expect(view).toMatchObject({ page: 1, pageCount: 1, total: 2 });
    expect(view.posts[0]?.publishedLabel).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });
});

describe("buildBlogPostView", () => {
  it("renders sanitized article HTML with h2 headings", () => {
    const post = fixturePost();
    const view = buildBlogPostView(
      { ...post, content: `${post.content}\n\n<script>alert(1)</script>` },
      SITE,
    );

    expect(view.contentHtml).toContain("<h2>Start with the notes</h2>");
    expect(view.contentHtml).not.toContain("<script");
  });

  it("uses the SEO component when it is filled in", () => {
    const post = fixturePost();
    const view = buildBlogPostView(
      {
        ...post,
        seo: {
          metaTitle: "Choosing a perfume",
          metaDescription: "A short guide.",
          ogImage: {
            url: `${CMS}/uploads/og.jpg`,
            alt: "",
            width: 1200,
            height: 630,
            srcSet: null,
          },
        },
      },
      SITE,
    );

    expect(view.seo).toEqual({
      title: "Choosing a perfume",
      description: "A short guide.",
      image: `${CMS}/uploads/og.jpg`,
      canonicalUrl: "https://jassmin.ua/blog/how-to-choose-a-perfume",
    });
  });

  it("falls back to the title, excerpt and cover image", () => {
    const post = fixturePost();
    const view = buildBlogPostView({ ...post, seo: null }, SITE);

    expect(view.seo.title).toBe(post.title);
    expect(view.seo.description).toBe(post.excerpt);
    expect(view.seo.image).toBe(post.coverImage?.url);
  });

  it("falls back to the article text, then the default description", () => {
    const post = { ...fixturePost(), seo: null, excerpt: null, coverImage: null };

    const fromText = buildBlogPostView(post, SITE);
    expect(fromText.seo.description).toMatch(/^Start with the notes A perfume changes/);
    expect(fromText.seo.image).toBeNull();

    const empty = buildBlogPostView({ ...post, content: "" }, SITE);
    expect(empty.seo.description).toBe(DEFAULT_BLOG_DESCRIPTION);
  });
});

describe("blogCacheHeaders", () => {
  it("lets shared caches store pages for visitors without a session", () => {
    const headers = blogCacheHeaders(new Request("http://localhost/blog"));
    expect(headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(headers.get("Vary")).toBe("Cookie");
  });

  it("keeps pages private when the visitor has a session", () => {
    const request = new Request("http://localhost/blog", {
      headers: { Cookie: "theme=light; __jassmin_session=abc" },
    });
    const headers = blogCacheHeaders(request);
    expect(headers.get("Cache-Control")).toBe("private, no-cache");
    expect(headers.get("Vary")).toBe("Cookie");
  });

  it("ignores other cookies", () => {
    const request = new Request("http://localhost/blog", {
      headers: { Cookie: "x__jassmin_session=abc; other=1" },
    });
    expect(blogCacheHeaders(request).get("Cache-Control")).toMatch(/^public/);
  });
});
