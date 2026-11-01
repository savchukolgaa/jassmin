import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { ProductDetail, ProductVariant } from "~/lib/products";
import { ProductPurchase } from "./ProductPurchase";
import { ProductFamilies, ProductNotes } from "./ProductScent";

// Fetchers need a data router. Rendered in English, like the assertions.
const render = (element: ReactElement, locale: Locale = "en") => {
  const router = createMemoryRouter([{ path: "/en/perfumes/:handle", element }], {
    initialEntries: ["/en/perfumes/coco-mademoiselle-eau-de-parfum"],
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  ).replace(/\s/gu, " ");
};

const variant = (volumeMl: number, price: string, stockQuantity: number): ProductVariant => ({
  id: `01a1652b-6e25-7d00-8000-${String(volumeMl).padStart(12, "0")}`,
  volumeMl,
  price,
  stockQuantity,
  inStock: stockQuantity > 0,
});

const PRODUCT: ProductDetail = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "coco-mademoiselle-eau-de-parfum",
  title: "Coco Mademoiselle Eau de Parfum",
  brand: "Chanel",
  gender: "women",
  packSize: 1,
  image: null,
  description: null,
  fragranceFamilies: ["шипрові", "квіткові"],
  notes: ["апельсин", "троянда", "пачулі"],
  storeCode: "3-D",
  variants: [
    variant(5, "990.00", 0),
    variant(10, "1350.00", 2),
    variant(50, "6850.00", 6),
    variant(100, "9900.00", 0),
  ],
};

const purchase = (product: ProductDetail = PRODUCT) =>
  render(createElement(ProductPurchase, { product }));

/** Each `<option>`'s opening tag and label, in order. */
const options = (html: string) =>
  [...html.matchAll(/(<option[^>]*>)([^<]*)<\/option>/g)].map((m) => ({
    tag: m[1] ?? "",
    label: m[2] ?? "",
  }));

describe("ProductPurchase", () => {
  it("lists every size in ascending order with its price", () => {
    expect(options(purchase()).map((o) => o.label)).toEqual([
      "5 ml — ₴990 (out of stock)",
      "10 ml — ₴1,350",
      "50 ml — ₴6,850",
      "100 ml — ₴9,900 (out of stock)",
    ]);
  });

  it("disables sold-out sizes and preselects the smallest one in stock", () => {
    const tags = options(purchase()).map((o) => o.tag);

    expect(tags[0]).toContain('disabled=""');
    expect(tags[1]).not.toContain('disabled=""');
    expect(tags[1]).toContain('selected=""');
    expect(tags[3]).toContain('disabled=""');
  });

  it("shows the selected size's price and stock", () => {
    const html = purchase();

    expect(html).toMatch(/<span[^>]*animate-spin-in[^>]*>₴1,350<\/span>/);
    expect(html).toContain("Only 2 left");
  });

  it("puts the volume select inside the add-to-cart form", () => {
    const html = purchase();
    const form = html.match(/<form[^>]*>.*<\/form>/)?.[0] ?? "";

    expect(form).toContain('action="/en/cart"');
    expect(form).toContain('name="variantId"');
    expect(form).toContain(`name="productId" value="${PRODUCT.id}"`);
    expect(form).toMatch(/<label[^>]*>Volume<select/);
    expect(form).not.toMatch(/type="hidden" name="variantId"/);
  });

  it("disables add to cart when every size is sold out", () => {
    const html = purchase({
      ...PRODUCT,
      variants: [variant(30, "1990.00", 0), variant(100, "3890.00", 0)],
    });

    expect(options(html)[0]?.tag).toContain('selected=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Out of stock/);
  });

  it("is unavailable without sizes", () => {
    const html = purchase({ ...PRODUCT, variants: [] });

    expect(html).not.toContain("<select");
    expect(html).toContain("Currently unavailable");
  });
});

describe("ProductFamilies", () => {
  it("lists every family, primary first, in the UI's language", () => {
    const html = render(createElement(ProductFamilies, { families: PRODUCT.fragranceFamilies }));
    expect(html).toContain('aria-label="Fragrance families"');
    expect(html.indexOf(">Chypre<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Chypre<")).toBeLessThan(html.indexOf(">Floral<"));

    const uk = render(
      createElement(ProductFamilies, { families: PRODUCT.fragranceFamilies }),
      "uk",
    );
    expect(uk).toContain('aria-label="Сімейства аромату"');
    expect(uk).toContain(">Шипрові<");
    expect(uk).toContain(">Квіткові<");
  });

  it("renders nothing without families", () => {
    expect(render(createElement(ProductFamilies, { families: [] }))).not.toContain("<ul");
  });
});

describe("ProductNotes", () => {
  it("lists the notes under a heading, marked as Ukrainian on the English site", () => {
    const html = render(createElement(ProductNotes, { notes: PRODUCT.notes }));
    expect(html).toContain(">Scent notes</h2>");
    expect(html).toContain('<ul lang="uk"');
    for (const note of PRODUCT.notes) {
      expect(html).toContain(`>${note}</li>`);
    }

    const uk = render(createElement(ProductNotes, { notes: PRODUCT.notes }), "uk");
    expect(uk).toContain(">Ноти аромату</h2>");
    expect(uk).not.toContain('lang="uk"');
  });

  it("renders nothing without notes", () => {
    expect(render(createElement(ProductNotes, { notes: [] }))).not.toContain("<section");
  });
});
