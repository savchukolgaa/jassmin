import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { PopularPageView } from "~/lib/popular";
import type { ProductSummary } from "~/lib/products";
import { PopularPage } from "./PopularPage";

function product(n: number, overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: `01a1652b-6e25-7c44-8d5b-${String(n).padStart(12, "0")}`,
    title: `Perfume ${n}`,
    brand: "House",
    gender: "women",
    packSize: 1,
    imageUrl: null,
    variants: [10, 30, 50].map((volumeMl, i) => ({
      id: `01a1652b-6e25-7c44-8d5b-${String(n + 500 + i * 100).padStart(12, "0")}`,
      volumeMl,
      price: `${450 + i * 600}.00`,
      inStock: true,
    })),
    minPrice: "450.00",
    hasPriceRange: true,
    volumes: [10, 30, 50],
    inStock: true,
    defaultVariant: {
      id: `01a1652b-6e25-7c44-8d5b-${String(n + 500).padStart(12, "0")}`,
      volumeMl: 10,
    },
    fragranceFamily: "квіткові",
    ...overrides,
  };
}

function view(overrides: Partial<PopularPageView> = {}): PopularPageView {
  return {
    products: [product(1), product(2)],
    total: 2,
    page: 1,
    pageCount: 1,
    families: [],
    ...overrides,
  };
}

// Ukrainian unless a test asks for English, like the storefront's default.
const render = (pageView: PopularPageView, locale?: Locale) => {
  const router = createMemoryRouter([
    { path: "*", element: createElement(PopularPage, { view: pageView }) },
  ]);
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
};

const href = (params: [string, string][]) => `/popular?${new URLSearchParams(params)}`;
const html = (value: string) => value.replaceAll("&", "&amp;");

describe("PopularPage", () => {
  it("renders the band, the count and the cards in order with quick add", () => {
    const page = render(view());

    expect(page).toContain(">Популярні аромати</h1>");
    expect(page).toContain("bg-primary");
    expect(page).toContain(">2 парфуми<");
    expect(page.indexOf("Perfume 1")).toBeLessThan(page.indexOf("Perfume 2"));
    expect(page.match(/name="intent" value="add"/g)).toHaveLength(2);
    expect(page).toContain("card-tilt");
    expect(page).toContain('href="/catalog/women"');
    expect(page).toContain('href="/catalog/men"');
  });

  it("renders in English", () => {
    const page = render(view(), "en");

    expect(page).toContain(">Popular perfumes</h1>");
    expect(page).toContain(">Bestsellers<");
    expect(page).toContain(">2 perfumes<");
    expect(page).toContain("Looking for something else?");
  });

  it("links the pages, keeping the chosen families", () => {
    const families = [
      { value: "квіткові", label: "Floral" },
      { value: "свіжі", label: "Fresh" },
    ];
    const page = render(view({ total: 30, page: 2, pageCount: 3, families }), "en");

    expect(page).toContain(
      `href="${html(
        href([
          ["family", "квіткові"],
          ["family", "свіжі"],
          ["page", "3"],
        ]),
      )}"`,
    );
    expect(page).toContain(
      `href="${html(
        href([
          ["family", "квіткові"],
          ["family", "свіжі"],
        ]),
      )}"`,
    );
    expect(page).toMatch(/aria-current="page"[^>]*>2</);
    expect(page).toContain('aria-label="Pagination"');
  });

  it("hides the pages when everything fits on one", () => {
    expect(render(view(), "en")).not.toContain('aria-label="Pagination"');
  });

  it("shows the trio's families as chips that each remove one, and a link to all", () => {
    const families = [
      { value: "квіткові", label: "Floral" },
      { value: "фруктові", label: "Fruity" },
      { value: "водяні", label: "Aquatic" },
    ];
    const page = render(view({ families }), "en");

    expect(page).toContain("Your trio:");
    const withoutFloral = html(
      href([
        ["family", "фруктові"],
        ["family", "водяні"],
      ]),
    );
    const floral = page.match(/<a aria-label="Remove Floral"[^>]*>/)?.[0];
    expect(floral).toContain(`href="${withoutFloral}"`);
    expect(page).toMatch(/href="\/popular"[^>]*>Show all popular</);
  });

  it("shows no chips without families", () => {
    expect(render(view(), "en")).not.toContain("Your trio:");
  });

  it("shows the empty state when nothing is listed", () => {
    const page = render(view({ products: [], total: 0 }), "en");

    expect(page).toContain("No popular perfumes yet");
    expect(page).not.toContain("Looking for something else?");
    expect(page).not.toContain("Show all popular");
    expect(page).toContain('href="/catalog/women"');
  });

  it("offers every popular perfume when the trio's families match none", () => {
    const families = [{ value: "водяні", label: "Aquatic" }];
    const page = render(view({ products: [], total: 0, families }), "en");

    expect(page).toContain("No popular perfumes with these families yet");
    expect(page).toMatch(/<a[^>]*href="\/popular"[^>]*>Show all popular<\/a>/);
  });
});
