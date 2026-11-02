import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ProductDetail } from "~/lib/products";

vi.mock("~/.server/services/products", () => ({ resolveProductHandle: vi.fn() }));
vi.mock("~/.server/analytics", () => ({ trackEvent: vi.fn() }));

const { default: Product } = await import("./product");

const SITE = "https://jassmin.ua";

const product: ProductDetail = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "coco-mademoiselle",
  title: "Coco Mademoiselle",
  brand: "Chanel",
  gender: "women",
  packSize: 1,
  image: { url: "/images/coco.jpg", srcSet: null, width: null, height: null },
  description: "</script><script>alert(1)</script>",
  fragranceFamilies: [],
  notes: [],
  storeCode: "3-D",
  variants: [
    { id: "v-10", volumeMl: 10, price: "1250.00", stockQuantity: 5, inStock: true },
    { id: "v-50", volumeMl: 50, price: "3200.00", stockQuantity: 0, inStock: false },
  ],
};

/** Renders the product page under a root route whose loader data holds the site URL (#85). */
function render(detail: ProductDetail, available = true) {
  const Page = Product as unknown as ComponentType<{
    loaderData: { product: ProductDetail; available: boolean; similar: [] };
  }>;
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "/",
        children: [
          {
            path: "products/:handle",
            element: createElement(Page, {
              loaderData: { product: detail, available, similar: [] },
            }),
          },
        ],
      },
    ],
    {
      initialEntries: ["/products/coco-mademoiselle"],
      hydrationData: { loaderData: { root: { site: { url: SITE } } } },
    },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function jsonLd(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) =>
    JSON.parse(match[1] ?? "null"),
  );
}

describe("product page JSON-LD (#86)", () => {
  it("outputs a Product with UAH offers per size and the breadcrumb list", () => {
    const html = render(product);
    const [productData, breadcrumbs] = jsonLd(html);

    expect(productData).toMatchObject({
      "@type": "Product",
      url: `${SITE}/parfumy/coco-mademoiselle`,
      image: `${SITE}/images/coco.jpg`,
      sku: "3-D",
      offers: [
        { price: "1250.00", priceCurrency: "UAH", availability: "https://schema.org/InStock" },
        { price: "3200.00", priceCurrency: "UAH", availability: "https://schema.org/OutOfStock" },
      ],
    });
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: `${SITE}/` },
        { position: 2, item: `${SITE}/katalog/zhinochi` },
        { position: 3, item: `${SITE}/parfumy/coco-mademoiselle` },
      ],
    });
    // The description's `</script>` stays inside the JSON.
    expect(html).not.toContain("<script>alert(1)");
  });

  it("leaves out the Product without sizes but keeps the breadcrumbs", () => {
    const types = jsonLd(render({ ...product, variants: [] })).map((data) => data["@type"]);

    expect(types).toEqual(["BreadcrumbList"]);
  });

  it("leaves out the Product of an archived perfume, which isn't sold anymore (#88)", () => {
    const types = jsonLd(render(product, false)).map((data) => data["@type"]);
    expect(types).not.toContain("Product");
    expect(types).toContain("BreadcrumbList");
  });
});

describe("product page headings (#88)", () => {
  const headings = (html: string) => [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));

  it("has exactly one h1, the perfume's name, and no skipped levels", () => {
    const html = render(product);
    const levels = headings(html);

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Coco Mademoiselle<\/h1>/);
    for (const [i, level] of levels.entries()) {
      expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it("gives the main photo a translated alt and loads it first", () => {
    const img = render(product).match(/<img[^>]*>/)?.[0] ?? "";
    expect(img).toContain('alt="Chanel Coco Mademoiselle"');
    expect(img).toContain('fetchPriority="high"');
  });
});
