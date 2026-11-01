import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ getCatalogPage: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/analytics", () => analytics);

const { loader, meta, shouldRevalidate } = await import("./catalog");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

const context = {};
const page = {
  products: [],
  total: 3,
  page: 1,
  pageCount: 1,
  filterOptions: { brands: [], fragranceFamilies: [] },
};

function load(gender: string, query = "") {
  const request = new Request(`http://localhost/catalog/${gender}${query}`);
  return loader({ request, params: { gender }, context } as unknown as LoaderArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  products.getCatalogPage.mockResolvedValue(page);
});

describe("catalog loader", () => {
  it("records a search when the shopper filters or sorts", async () => {
    await load("women", "?brand=Chanel&sort=price_asc");

    expect(analytics.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context }),
      "search",
      {
        properties: { gender: "women", brand: "Chanel", sort: "price_asc", page: 1, total: 3 },
      },
    );
  });

  it("records nothing for the plain catalog", async () => {
    expect(await load("men")).toMatchObject({ gender: "men", total: 3 });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown catalog", async () => {
    await expect(load("unisex")).rejects.toMatchObject({ init: { status: 404 } });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });
});

describe("catalog shouldRevalidate", () => {
  const args = (overrides: Partial<ShouldRevalidateFunctionArgs>) =>
    ({ defaultShouldRevalidate: true, ...overrides }) as ShouldRevalidateFunctionArgs;

  it("doesn't reload (and re-record the search) after a form post", () => {
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/cart" }))).toBe(false);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/locale" }))).toBe(false);
  });

  it("reloads when the filters change", () => {
    expect(shouldRevalidate(args({}))).toBe(true);
    expect(shouldRevalidate(args({ formMethod: "GET", formAction: "/catalog/men" }))).toBe(true);
    expect(shouldRevalidate(args({ defaultShouldRevalidate: false }))).toBe(false);
  });
});

describe("catalog meta", () => {
  const root = (locale: string) => [
    { id: "root", loaderData: { locale, site: { url: "https://jassmin.ua" } } },
  ];
  const search = { sort: "newest", page: 1 };
  const run = (
    gender: "women" | "men",
    {
      locale = "uk",
      query = "",
      overrides = {},
    }: { locale?: string; query?: string; overrides?: object } = {},
  ) =>
    meta({
      matches: root(locale),
      location: { pathname: `/catalog/${gender}`, search: query },
      loaderData: { ...page, gender, search, ...overrides },
    } as unknown as MetaArgs);
  const description = (tags: ReturnType<typeof run>) =>
    tags.find((tag) => "name" in tag && tag.name === "description");

  it("has a translated title and description per gender", () => {
    const women = run("women");
    const men = run("men", { locale: "en" });

    expect(women).toContainEqual({ title: "Жіночі парфуми — Jassmin" });
    expect(description(women)).toMatchObject({
      content: expect.stringContaining("Жіночі парфуми"),
    });
    expect(men).toContainEqual({ title: "Men Perfumes — Jassmin" });
    expect(description(men)).toMatchObject({ content: expect.stringContaining("Men's perfumes") });
  });

  it("points filtered and sorted views to the unfiltered catalog", () => {
    const tags = run("women", {
      query: "?brand=Chanel&sort=price_asc&page=2",
      overrides: { page: 2, search: { brand: "Chanel", sort: "price_asc", page: 2 } },
    });

    expect(tags).toContainEqual({ title: "Жіночі парфуми — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/catalog/women",
    });
  });

  it("makes later unfiltered pages self-canonical with a numbered title", () => {
    const tags = run("men", {
      query: "?page=3&utm_source=ig",
      overrides: { page: 3, search: { ...search, page: 3 } },
    });

    expect(tags).toContainEqual({ title: "Чоловічі парфуми — сторінка 3 — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/catalog/men?page=3",
    });
  });
});
