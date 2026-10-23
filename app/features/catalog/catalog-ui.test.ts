import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { CatalogSearch } from "~/lib/catalog";
import { I18nProvider } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import { CatalogFilters } from "./CatalogFilters";
import { ProductCard } from "./ProductCard";

// Fetchers and `<Form>` need a data router. Rendered in English, like the assertions.
const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "/catalog/:gender", element }], {
    initialEntries: ["/catalog/women"],
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
};

const normalize = (html: string) => html.replace(/\s/gu, " ");

/** The opening tag of the first `<form>`. */
const formTag = (html: string) => html.match(/<form[^>]*>/)?.[0] ?? "";

/** The opening tag of the first `<button>`. */
const buttonTag = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? "";

const VARIANT_ID = "01a1652b-6e25-7d00-8000-000000000007";

const PRODUCT: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  title: "Coco Mademoiselle Eau de Parfum",
  brand: "Chanel",
  gender: "women",
  packSize: 1,
  imageUrl: null,
  minPrice: "990.00",
  hasPriceRange: true,
  volumes: [7, 30, 50],
  inStock: true,
  defaultVariant: { id: VARIANT_ID, volumeMl: 7 },
};

/** A product sold in one size only. */
const SINGLE: ProductSummary = {
  ...PRODUCT,
  minPrice: "6850.00",
  hasPriceRange: false,
  volumes: [50],
  defaultVariant: { id: VARIANT_ID, volumeMl: 50 },
};

const chooseVolume = /<a[^>]*href="\/products\/[^"]+"[^>]*>Choose volume<\/a>/;

const SEARCH: CatalogSearch = { sort: "newest", page: 1 };

describe("ProductCard", () => {
  it("shows the brand, title, sizes and lowest price and links to the product", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));

    expect(html).toContain("Chanel");
    expect(html).toContain("Coco Mademoiselle Eau de Parfum");
    expect(html).toContain("7 · 30 · 50 ml");
    expect(html).toContain("from ₴990");
    expect(html).toContain(`href="/products/${PRODUCT.id}"`);
  });

  it("shows a single size's price without 'from'", () => {
    const html = normalize(render(createElement(ProductCard, { product: SINGLE })));

    expect(html).toContain("₴6,850");
    expect(html).not.toContain("from ");
  });

  it("posts the default variant to the cart and names its size", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));

    expect(formTag(html)).toContain('method="post"');
    expect(formTag(html)).toContain('action="/cart"');
    expect(html).toContain('name="intent" value="add"');
    expect(html).toContain(`name="productId" value="${PRODUCT.id}"`);
    expect(html).toContain(`name="variantId" value="${VARIANT_ID}"`);
    expect(buttonTag(html)).not.toContain(' disabled=""');
    expect(html).toContain("Add 7 ml");
  });

  it("offers 'Choose volume' next to add to cart only for several sizes", () => {
    expect(render(createElement(ProductCard, { product: PRODUCT }))).toMatch(chooseVolume);
    expect(render(createElement(ProductCard, { product: SINGLE }))).not.toMatch(chooseVolume);
  });

  it("disables add to cart when the product is out of stock but keeps 'Choose volume'", () => {
    const html = render(createElement(ProductCard, { product: { ...PRODUCT, inStock: false } }));

    expect(buttonTag(html)).toContain(' disabled=""');
    expect(html).toContain("Out of stock");
    expect(html).toMatch(chooseVolume);
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
