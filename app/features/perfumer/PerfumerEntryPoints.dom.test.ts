// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATALOG_SORT } from "~/lib/catalog";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { ProductDetail } from "~/lib/products";
import { PerfumerEntryLink } from "./PerfumerEntryLink";

// The route modules' server imports, never called when only rendering their components.
vi.mock("~/.server/services/products", () => ({}));
vi.mock("~/.server/analytics", () => ({}));

const { default: Catalog } = await import("~/routes/catalog");
const { default: Product } = await import("~/routes/product");

// The links into the AI perfumer chat (#165): the shared prefilled link, the catalog banner and
// empty state, and the product page's "find similar".

/** Renders `element` under a shop layout whose loader says whether the perfumer is enabled. */
function renderInShop(
  page: ReactElement | (() => ReactElement),
  { enabled = true, locale = "uk" as Locale, url = "/aktsii" } = {},
) {
  const shop = { perfumerEnabled: enabled };
  const element = typeof page === "function" ? createElement(page) : page;
  const router = createMemoryRouter(
    [
      {
        id: "routes/_shop",
        path: "/",
        loader: () => shop,
        element: createElement(Outlet),
        children: [{ path: "*", element }],
      },
    ],
    { initialEntries: [url], hydrationData: { loaderData: { "routes/_shop": shop } } },
  );
  return render(createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })));
}

/** The `q` a link sends, decoded. */
function prefillOf(link: HTMLElement): string | null {
  return new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams.get("q");
}

afterEach(cleanup);

describe("PerfumerEntryLink", () => {
  it("links to the chat in the page's language with the message in `q`, nofollow", () => {
    const message = "Схоже на Light Blue від Dolce & Gabbana";
    renderInShop(createElement(PerfumerEntryLink, { message }, "Запитати"));

    const link = screen.getByRole("link", { name: "Запитати" });
    expect(link.getAttribute("href")).toMatch(/^\/parfumer\?q=/);
    expect(prefillOf(link)).toBe(message);
    expect(link.getAttribute("rel")).toBe("nofollow");
  });

  it("uses the English chat path in English", () => {
    renderInShop(createElement(PerfumerEntryLink, { message: "Hi" }, "Ask"), {
      locale: "en",
    });
    expect(screen.getByRole("link", { name: "Ask" }).getAttribute("href")).toBe(
      "/en/perfumer?q=Hi",
    );
  });

  it("renders nothing while the perfumer is disabled", () => {
    renderInShop(createElement(PerfumerEntryLink, { message: "Hi" }, "Ask"), {
      enabled: false,
    });
    expect(screen.queryByRole("link")).toBeNull();
  });
});

type CatalogProps = Parameters<typeof Catalog>[0];
type ProductProps = Parameters<typeof Product>[0];

function catalogPage({ empty = false, brand }: { empty?: boolean; brand?: string } = {}) {
  const loaderData = {
    gender: "women",
    search: { fragranceFamily: "цитрусові", brand, sort: DEFAULT_CATALOG_SORT, page: 1 },
    searchId: null,
    products: empty
      ? []
      : [
          {
            id: "p1",
            slug: "libre",
            title: "Libre",
            brand: "YSL",
            gender: "women",
            packSize: 1,
            image: null,
            variants: [{ id: "v1", volumeMl: 5, price: "500.00", inStock: true }],
            minPrice: "500.00",
            hasPriceRange: false,
            volumes: [5],
            inStock: true,
            defaultVariant: { id: "v1", volumeMl: 5 },
            fragranceFamily: null,
          },
        ],
    total: empty ? 0 : 1,
    page: 1,
    pageCount: 1,
    filterOptions: { brands: [], fragranceFamilies: [] },
  };
  return () => createElement(Catalog, { loaderData } as unknown as CatalogProps);
}

describe("catalog entry points", () => {
  it("shows the banner above the results, asking with the filters", () => {
    renderInShop(catalogPage({ brand: "Lancôme" }), { url: "/katalog/zhinochi" });

    expect(screen.getByRole("complementary", { name: "Не знаєте, що обрати?" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Запитати AI парфумера" });
    expect(prefillOf(link)).toBe("Допоможіть обрати жіночий аромат: цитрусові, бренд Lancôme");
  });

  it("offers the perfumer in the empty results instead of the banner", () => {
    renderInShop(catalogPage({ empty: true }), { url: "/katalog/zhinochi" });

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText("Або опишіть, що шукаєте, AI парфумеру.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Запитати AI парфумера" });
    expect(prefillOf(link)).toBe("Допоможіть обрати жіночий аромат: цитрусові");
  });

  it("has neither while the perfumer is disabled", () => {
    renderInShop(catalogPage(), { url: "/katalog/zhinochi", enabled: false });
    expect(screen.queryByRole("complementary")).toBeNull();
    cleanup();

    renderInShop(catalogPage({ empty: true }), { url: "/katalog/zhinochi", enabled: false });
    expect(screen.queryByText("Або опишіть, що шукаєте, AI парфумеру.")).toBeNull();
    expect(screen.queryByRole("link", { name: /AI парфумера/ })).toBeNull();
  });
});

const PRODUCT: ProductDetail = {
  id: "p1",
  slug: "light-blue",
  title: "Light Blue",
  brand: "Dolce & Gabbana",
  gender: "women",
  packSize: 1,
  image: null,
  description: null,
  descriptionLocale: "uk",
  fragranceFamilies: [],
  notes: [],
  storeCode: null,
  variants: [],
};

function productPage() {
  return () =>
    createElement(Product, {
      loaderData: { product: PRODUCT, available: false, similar: [] },
    } as unknown as ProductProps);
}

describe("product page entry point", () => {
  it("asks the perfumer for perfumes like this one", () => {
    renderInShop(productPage(), { url: "/parfumy/light-blue" });

    const link = screen.getByRole("link", { name: "Знайти схожі з AI парфумером" });
    expect(prefillOf(link)).toBe("Схоже на Light Blue від Dolce & Gabbana");
    expect(link.getAttribute("rel")).toBe("nofollow");
  });

  it("asks in English on the English page", () => {
    renderInShop(productPage(), { url: "/en/perfumes/light-blue", locale: "en" });

    const link = screen.getByRole("link", { name: "Find similar with the AI perfumer" });
    expect(prefillOf(link)).toBe("Something like Light Blue by Dolce & Gabbana");
  });

  it("is absent while the perfumer is disabled", () => {
    renderInShop(productPage(), { url: "/parfumy/light-blue", enabled: false });
    expect(screen.queryByRole("link", { name: /AI парфумером/ })).toBeNull();
  });
});
