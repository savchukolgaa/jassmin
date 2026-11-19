import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SimilarProducts } from "~/features/product/ProductArchived";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import { RecommendedProducts } from "./RecommendedProducts";

// Fetchers need a data router.
const render = (element: ReactElement, locale: Locale = "en") => {
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  ).replace(/\s/gu, " ");
};

function product(n: number): ProductSummary {
  const id = `01a1652b-6e25-7c03-ae47-${String(n).padStart(12, "0")}`;
  return {
    id,
    slug: `perfume-${n}`,
    title: `Perfume ${n}`,
    brand: "Brand",
    gender: "women",
    packSize: 1,
    image: null,
    variants: [
      { id: `${id.slice(0, -2)}10`, volumeMl: 10, price: "190.00", inStock: true },
      { id: `${id.slice(0, -2)}50`, volumeMl: 50, price: "1890.00", inStock: true },
    ],
    minPrice: "190.00",
    hasPriceRange: true,
    volumes: [10, 50],
    inStock: true,
    defaultVariant: { id: `${id.slice(0, -2)}10`, volumeMl: 10 },
    fragranceFamily: null,
  };
}

describe("RecommendedProducts", () => {
  it("lists the cards under an h2, posting their list and 1-based position (#182)", () => {
    const html = render(
      createElement(RecommendedProducts, {
        id: "recs-cart",
        title: "Complete your trio",
        subtitle: "Add 2 more testers",
        listId: "recs_cart",
        products: [product(1), product(2)],
      }),
    );

    expect(html).toMatch(/<h2 id="recs-cart-heading"[^>]*>Complete your trio<\/h2>/);
    expect(html).toContain('aria-labelledby="recs-cart-heading"');
    expect(html).toContain("Add 2 more testers");
    expect(html).toMatch(/<h3[^>]*><a[^>]*>Perfume 1<\/a><\/h3>/);
    expect(html.match(/name="listId" value="recs_cart"/gu)).toHaveLength(2);
    expect(html).toContain('name="listPosition" value="1"');
    expect(html).toContain('name="listPosition" value="2"');
  });

  it("renders nothing without products", () => {
    expect(
      render(
        createElement(RecommendedProducts, {
          id: "recs",
          title: "For you",
          listId: "recs_for_you",
          products: [],
        }),
      ),
    ).toBe("");
  });
});

describe("SimilarProducts", () => {
  it("is 'Customers also chose' in the recs_product list for recommendations", () => {
    const html = render(createElement(SimilarProducts, { products: [product(1)], source: "recs" }));
    expect(html).toMatch(/<h2[^>]*>Customers also chose<\/h2>/);
    expect(html).toContain('name="listId" value="recs_product"');
  });

  it("keeps 'Similar perfumes' in the similar list for the family-based fallback", () => {
    const html = render(createElement(SimilarProducts, { products: [product(1)] }), "uk");
    expect(html).toMatch(/<h2[^>]*>Схожі парфуми<\/h2>/);
    expect(html).toContain('name="listId" value="similar"');
  });

  it("is translated", () => {
    const html = render(
      createElement(SimilarProducts, { products: [product(1)], source: "recs" }),
      "uk",
    );
    expect(html).toMatch(/<h2[^>]*>Покупці також обирали<\/h2>/);
  });
});
