import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { CatalogSearch } from "~/lib/catalog";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import { CatalogFilters } from "./CatalogFilters";
import { ProductCard } from "./ProductCard";

// Fetchers and `<Form>` need a data router. Rendered in English, like the assertions.
const render = (element: ReactElement, locale: Locale = "en") => {
  const router = createMemoryRouter([{ path: "/catalog/:gender", element }], {
    initialEntries: ["/catalog/women"],
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
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
  variants: [
    { id: VARIANT_ID, volumeMl: 7, price: "990.00", inStock: true },
    { id: "01a1652b-6e25-7d00-8000-000000000030", volumeMl: 30, price: "3490.00", inStock: true },
    { id: "01a1652b-6e25-7d00-8000-000000000050", volumeMl: 50, price: "4890.00", inStock: false },
  ],
  minPrice: "990.00",
  hasPriceRange: true,
  volumes: [7, 30, 50],
  inStock: true,
  defaultVariant: { id: VARIANT_ID, volumeMl: 7 },
  fragranceFamily: "шипрові",
};

/** A product sold in one size only. */
const SINGLE: ProductSummary = {
  ...PRODUCT,
  variants: [{ id: VARIANT_ID, volumeMl: 50, price: "6850.00", inStock: true }],
  minPrice: "6850.00",
  hasPriceRange: false,
  volumes: [50],
  defaultVariant: { id: VARIANT_ID, volumeMl: 50 },
};

/** The opening tags of the size radios (#74). */
const radios = (html: string) => html.match(/<input type="radio"[^>]*>/g) ?? [];

/** The first `<form>` with its contents. */
const formOf = (html: string) => html.match(/<form[\s\S]*<\/form>/)?.[0] ?? "";

const SEARCH: CatalogSearch = { sort: "newest", page: 1 };

describe("ProductCard", () => {
  it("shows the brand, title and lowest price and links to the product", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));

    expect(html).toContain("Chanel");
    expect(html).toContain("Coco Mademoiselle Eau de Parfum");
    expect(html).toContain("from ₴990");
    expect(html).toContain(`href="/products/${PRODUCT.id}"`);
  });

  it("shows the primary fragrance family in the UI's language, and none without one", () => {
    expect(render(createElement(ProductCard, { product: PRODUCT }))).toContain(">Chypre<");
    expect(render(createElement(ProductCard, { product: PRODUCT }), "uk")).toContain(">Шипрові<");
    const html = render(
      createElement(ProductCard, { product: { ...PRODUCT, fragranceFamily: null } }),
    );
    expect(html).not.toContain("Chypre");
    expect(html).not.toContain("rounded-pill bg-blush");
  });

  it("lets the shopper pick a size with a radio per size inside the add-to-cart form", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));
    const form = formOf(html);
    const [seven, thirty, fifty] = radios(form);

    expect(form).toMatch(/<fieldset[^>]*><legend class="sr-only">Volume<\/legend>/);
    expect(radios(form)).toHaveLength(3);
    expect(radios(html)).toHaveLength(3);
    expect(seven).toContain('name="variantId"');
    expect(seven).toContain(`value="${VARIANT_ID}"`);
    expect(seven).toContain('checked=""');
    expect(seven).not.toContain("disabled");
    expect(thirty).not.toContain("checked");
    // 50 ml is sold out: shown, struck through and announced, but it can't be picked.
    expect(fifty).toContain('disabled=""');
    expect(form).toContain('50 ml<span class="sr-only">, out of stock</span>');
    expect(form).toContain(">7 ml<");
    expect(form).toContain(">30 ml<");
    // The radios post the size, so there's no hidden `variantId` next to them.
    expect(form).not.toContain('type="hidden" name="variantId"');
    expect(buttonTag(html)).not.toContain(' disabled=""');
    expect(html).toContain(">Add to cart<");
    expect(html).not.toContain("Choose volume");
  });

  it("gives every card's radios their own ids", () => {
    const html = render(
      createElement(
        "div",
        null,
        createElement(ProductCard, { product: PRODUCT }),
        createElement(ProductCard, { product: PRODUCT }),
      ),
    );
    const ids = [...html.matchAll(/<input type="radio" id="([^"]+)"/g)].map((m) => m[1]);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect([...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1])).toEqual(ids);
  });

  it("renders a price skeleton for JS and the lowest price without JS before hydration", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT })));

    const skeleton = html.match(/<span[^>]*data-price-skeleton[^>]*>/)?.[0] ?? "";
    expect(skeleton).toContain('aria-hidden="true"');
    expect(skeleton).toContain("in-[.js]:inline-block");
    expect(html).toContain('<span class="in-[.js]:hidden">from ₴990</span>');
  });

  it("shows a single size as text with its price, and posts it without a picker", () => {
    const html = normalize(render(createElement(ProductCard, { product: SINGLE })));

    expect(radios(html)).toHaveLength(0);
    expect(html).not.toContain("<fieldset");
    expect(html).toContain(">50 ml<");
    expect(html).toContain("₴6,850");
    expect(html).not.toContain("from ");
    expect(html).not.toContain("data-price-skeleton");
    expect(formTag(html)).toContain('action="/cart"');
    expect(html).toContain('name="intent" value="add"');
    expect(html).toContain(`name="productId" value="${PRODUCT.id}"`);
    expect(html).toContain(`type="hidden" name="variantId" value="${VARIANT_ID}"`);
  });

  it("labels the sizes of a pack with the unit count", () => {
    const html = normalize(
      render(createElement(ProductCard, { product: { ...PRODUCT, packSize: 3 } })),
    );

    expect(html).toContain(">3 × 7 ml<");
    expect(html).toContain(">3 × 30 ml<");
  });

  it("speaks Ukrainian", () => {
    const html = normalize(render(createElement(ProductCard, { product: PRODUCT }), "uk"));

    expect(html).toContain('<legend class="sr-only">Об’єм</legend>');
    expect(html).toContain('50 мл<span class="sr-only">, немає в наявності</span>');
    expect(html).toContain(">Додати в кошик<");
  });

  it("disables add to cart and every size when the product is out of stock", () => {
    const variants = PRODUCT.variants.map((v) => ({ ...v, inStock: false }));
    const html = render(
      createElement(ProductCard, { product: { ...PRODUCT, variants, inStock: false } }),
    );

    expect(buttonTag(html)).toContain(' disabled=""');
    expect(html).toContain("Out of stock");
    expect(radios(html).every((tag) => tag.includes('disabled=""'))).toBe(true);
  });
});

describe("ProductCard, compact (home bestsellers)", () => {
  const compact = (product: ProductSummary) =>
    normalize(render(createElement(ProductCard, { product, headingLevel: 3, variant: "compact" })));

  it("shows the family on the image, the brand, title and price", () => {
    const html = compact(PRODUCT);

    expect(html).toMatch(/<span class="absolute[^"]*">Chypre<\/span>/);
    expect(html).toMatch(/<p class="[^"]*">Chanel<\/p>/);
    expect(html).toMatch(/<h3[^>]*><a[^>]*>Coco Mademoiselle Eau de Parfum<\/a><\/h3>/);
    expect(html).toContain("from ₴990");
    expect(html).toContain("card-tilt");
    expect(html).toContain("data-zoom");
  });

  it("names a single size next to the brand", () => {
    expect(compact(SINGLE)).toContain("Chanel · 50 ml");
  });

  it("leaves the family badge out when the product has none", () => {
    expect(compact({ ...PRODUCT, fragranceFamily: null })).not.toContain("Chypre");
  });

  it("has the same size picker as the catalog card", () => {
    const form = formOf(compact(PRODUCT));

    expect(radios(form)).toHaveLength(3);
    expect(radios(form)[0]).toContain('checked=""');
    expect(radios(form)[2]).toContain('disabled=""');
    expect(form).not.toContain('type="hidden" name="variantId"');
  });

  it("quick-adds the picked size with a round + button named after the product", () => {
    const html = compact(PRODUCT);

    expect(formTag(html)).toContain('action="/cart"');
    expect(buttonTag(html)).toContain('aria-label="Add Coco Mademoiselle Eau de Parfum to cart"');
    expect(buttonTag(html)).toContain("quick-add");
    expect(html).toContain('<span aria-hidden="true">+</span>');
    expect(compact(SINGLE)).toContain(`type="hidden" name="variantId" value="${VARIANT_ID}"`);
  });

  it("disables the quick add when the product is out of stock", () => {
    const html = compact({ ...PRODUCT, inStock: false });

    expect(buttonTag(html)).toContain(' disabled=""');
    expect(buttonTag(html)).toContain('aria-label="Out of stock"');
  });
});

describe("CatalogFilters", () => {
  const options = {
    brands: ["Chanel", "Dior"],
    fragranceFamilies: ["водяні", "квіткові", "шипрові", "мікс"],
  };

  /** The family select's options as `[value, label]`, without "All families". */
  const familyOptions = (html: string) =>
    [
      ...(html.match(/<select name="fragrance_family"[\s\S]*?<\/select>/)?.[0] ?? "").matchAll(
        /<option value="([^"]+)"[^>]*>([^<]*)</g,
      ),
    ].map((m) => [m[1], m[2]]);

  it("labels the families in the UI's language, alphabetically, keeping the Ukrainian value", () => {
    const element = createElement(CatalogFilters, {
      pathname: "/catalog/women",
      search: SEARCH,
      options,
    });

    expect(familyOptions(render(element))).toEqual([
      ["водяні", "Aquatic"],
      ["шипрові", "Chypre"],
      ["квіткові", "Floral"],
      ["мікс", "мікс"],
    ]);
    expect(familyOptions(render(element, "uk"))).toEqual([
      ["водяні", "Водяні"],
      ["квіткові", "Квіткові"],
      ["мікс", "мікс"],
      ["шипрові", "Шипрові"],
    ]);
  });

  it("preselects the current family", () => {
    const html = render(
      createElement(CatalogFilters, {
        pathname: "/catalog/women",
        search: { ...SEARCH, fragranceFamily: "шипрові" },
        options,
      }),
    );
    expect(html).toMatch(/<option value="шипрові" selected="">Chypre</);
  });

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
