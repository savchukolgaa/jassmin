import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { blogHref } from "~/lib/blog";
import { catalogHref } from "~/lib/catalog";
import { Pagination, type PaginationProps } from "./Pagination";

const render = (props: PaginationProps) => {
  const router = createMemoryRouter([{ path: "*", element: createElement(Pagination, props) }]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
};

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const html = render({ page: 1, pageCount: 1, hrefForPage: blogHref });

    expect(html).not.toContain("Pagination");
  });

  it("links to every page, keeping the catalog filters", () => {
    const search = { sort: "newest", page: 2, brand: "Dior" } as const;
    const html = render({
      page: 2,
      pageCount: 3,
      hrefForPage: (page) => catalogHref("/catalog/men", search, page),
    });

    expect(html).toContain('href="/catalog/men?brand=Dior"');
    expect(html).toContain('href="/catalog/men?brand=Dior&amp;page=3"');
    expect(html).toMatch(/aria-current="page"[^>]*>2</);
    expect(html).toContain(">Previous<");
    expect(html).toContain(">Next<");
  });

  it("links blog pages and hides Previous on the first page", () => {
    const html = render({ page: 1, pageCount: 2, hrefForPage: blogHref });

    expect(html).toContain('href="/blog?page=2"');
    expect(html).not.toContain(">Previous<");
    expect(html).toContain(">Next<");
  });
});
