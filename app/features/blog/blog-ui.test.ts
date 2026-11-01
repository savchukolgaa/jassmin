import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { BlogPostCardView, BlogPostView } from "~/lib/blog";
import { I18nProvider } from "~/lib/i18n";
import { BlogArticle } from "./BlogArticle";
import { BlogPostCard } from "./BlogPostCard";

const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "*", element }]);
  // In English, like the assertions.
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
};

const card: BlogPostCardView = {
  locale: "en",
  slug: "how-to-choose-a-perfume",
  title: "How to choose a perfume",
  excerpt: "Top, heart and base notes.",
  coverImage: {
    url: "http://cms.test/uploads/cover.jpg",
    alt: "",
    width: 1200,
    height: 800,
    srcSet: "http://cms.test/uploads/small_cover.jpg 500w, http://cms.test/uploads/cover.jpg 1200w",
  },
  publishedAt: "2026-10-22T19:06:58.498Z",
  publishedLabel: "22 October 2026",
};

const post: BlogPostView = {
  ...card,
  updatedAt: "2026-10-23T08:00:00.000Z",
  authorName: "Jassmin team",
  alternates: {},
  contentHtml: "<h2>Start with the notes</h2>\n<p>A perfume changes.</p>\n",
  seo: {
    title: card.title,
    description: "Top, heart and base notes.",
    image: null,
  },
};

describe("BlogPostCard", () => {
  it("links the title to the article and shows the date and excerpt", () => {
    const html = render(createElement(BlogPostCard, { post: card }));

    expect(html).toMatch(/<a[^>]*href="\/en\/blog\/how-to-choose-a-perfume"[^>]*>How to choose/);
    expect(html).toContain('<time dateTime="2026-10-22T19:06:58.498Z">22 October 2026</time>');
    expect(html).toContain("Top, heart and base notes.");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('srcSet="http://cms.test/uploads/small_cover.jpg 500w');
  });

  it("marks a Ukrainian fallback post with lang=uk, and nothing for a translated one", () => {
    expect(render(createElement(BlogPostCard, { post: card }))).not.toContain(" lang=");

    const html = render(createElement(BlogPostCard, { post: { ...card, locale: "uk" } }));

    expect(html).toMatch(/<h2[^>]*lang="uk"/);
    expect(html).toMatch(/<p class="text-body" lang="uk">Top, heart/);
    expect(html).not.toMatch(/<time[^>]*lang=/);
  });

  it("shows a placeholder without a cover image", () => {
    const html = render(createElement(BlogPostCard, { post: { ...card, coverImage: null } }));

    expect(html).not.toContain("<img");
  });
});

describe("BlogArticle", () => {
  it("renders the title, author, eager cover and article HTML", () => {
    const html = render(createElement(BlogArticle, { post }));

    expect(html).toContain("<h1");
    expect(html).toContain("How to choose a perfume</h1>");
    expect(html).toContain("Jassmin team");
    expect(html).toContain('loading="eager"');
    expect(html).toContain("<h2>Start with the notes</h2>");
    // Breadcrumbs (#86): Home > Blog > the post, which isn't a link.
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toMatch(/href="\/en"[^>]*>Home<\/a>/);
    expect(html).toMatch(/href="\/en\/blog"[^>]*>Blog<\/a>/);
    expect(html).toMatch(/aria-current="page"[^>]*>How to choose a perfume<\/span>/);
    expect(html).toMatch(/href="\/en\/blog"[^>]*>← Back to the blog/);
    expect(html).not.toContain(" lang=");
  });

  it("marks the text of a Ukrainian fallback article with lang=uk", () => {
    const html = render(createElement(BlogArticle, { post: { ...post, locale: "uk" } }));

    expect(html).toMatch(/<h1[^>]*lang="uk"/);
    expect(html).toMatch(/<div lang="uk"[^>]*><h2>Start with the notes/);
    expect(html).toMatch(/lang="uk">Top, heart and base notes/);
    // The back link is UI copy in the page's language.
    expect(html).not.toMatch(/lang="uk"[^>]*>← Back/);
  });
});
