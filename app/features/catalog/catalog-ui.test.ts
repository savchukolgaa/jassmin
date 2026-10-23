import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { CatalogSearch } from "~/lib/catalog";
import type { ProductSummary } from "~/lib/products";
import { CatalogFilters } from "./CatalogFilters";
import { Pagination } from "./Pagination";
import { ProductCard } from "./ProductCard";

// Fetchers and `<Form>` need a data router.
const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "/catalog/:gender", element }], {
    initialEntries: ["/catalog/women"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
};

const normalize = (html: string) => html.replace(/\s/gu, " ");

/** The opening tag of the first `<form>`. */
const formTag = (html: string) => html.match(/<form[^>]*>/)?.[0] ?? "";

/** The opening tag of the first `<button>`. */
const buttonTag = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? "";

const PRODUCT: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  title: "Coco Mademoiselle Eau de Parfum",
  brand: "Chanel",
  gender: "women",
  price: "6850.00",
  volumeMl: 50,
  packSize: 1,
  imageUrl: null,
  inStock: true,
};

const SEARCH: CatalogSearch = { sort: "newest", page: 1 };

describe("ProductCard", () => {
  it("shows the brand, title, volume and price and links to the product", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));

    expect(html).toContain("Chanel");
    expect(html).toContain("Coco Mademoiselle Eau de Parfum");
    expect(html).toContain("50 ml");
    expect(html).toContain("6 850 ₴");
    expect(html).toContain(`href="/products/${PRODUCT.id}"`);
  });

  it("posts an add intent with the product id to the cart", () => {
    const html = render(createElement(ProductCard, { product: PRODUCT }));

    expect(formTag(html)).toContain('method="post"');
    expect(formTag(html)).toContain('action="/cart"');
    expect(html).toContain('name="intent" value="add"');
    expect(html).toContain(`name="productId" value="${PRODUCT.id}"`);
    expect(buttonTag(html)).not.toContain(' disabled=""');
  });

  it("disables add to cart when the product is out of stock", () => {
    const html = render(createElement(ProductCard, { product: { ...PRODUCT, inStock: false } }));

    expect(buttonTag(html)).toContain(' disabled=""');
    expect(html).toContain("Out of stock");
  });
});

describe("CatalogFilters", () => {
  const options = { brands: ["Chanel", "Dior"], fragranceFamilies: ["квіткові", "шипрові"] };

  it("is a GET form with the filter and sort fields", () => {
    const html = render(
      createElement(CatalogFilters, { pathname: "/catalog/women", search: SEARCH, options }),
    );

    expect(formTag(html)).toContain('method="get"');
    expect(formTag(html)).toContain('action="/catalog/women"');
    for (const name of ["fragrance_family", "brand", "sort"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).not.toContain('name="page"');
    expect(html).not.toContain(">Reset<");
  });

  it("preselects the current filters and offers a reset", () => {
    const html = render(
      createElement(CatalogFilters, {
        pathname: "/catalog/women",
        search: { ...SEARCH, brand: "Dior", sort: "price_asc" },
        options,
      }),
    );

    expect(html).toMatch(/<option value="Dior" selected="">/);
    expect(html).toMatch(/<option value="price_asc" selected="">/);
    expect(html).toMatch(/<a[^>]*href="\/catalog\/women"[^>]*>Reset<\/a>/);
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const html = render(
      createElement(Pagination, {
        pathname: "/catalog/men",
        search: SEARCH,
        page: 1,
        pageCount: 1,
      }),
    );

    expect(html).not.toContain("Pagination");
  });

  it("links to every page, keeping the filters", () => {
    const html = render(
      createElement(Pagination, {
        pathname: "/catalog/men",
        search: { ...SEARCH, brand: "Dior" },
        page: 2,
        pageCount: 3,
      }),
    );

    expect(html).toContain('href="/catalog/men?brand=Dior"');
    expect(html).toContain('href="/catalog/men?brand=Dior&amp;page=3"');
    expect(html).toMatch(/aria-current="page"[^>]*>2</);
    expect(html).toContain(">Previous<");
    expect(html).toContain(">Next<");
  });
});
