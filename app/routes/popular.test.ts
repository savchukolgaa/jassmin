import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ getPopularPage: vi.fn(), getTrioFamilies: vi.fn() }));
const locale = vi.hoisted(() => ({ getLocale: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/locale", () => locale);

const { loader, meta, shouldRevalidate } = await import("./popular");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

const EN = [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }];
const LOCATION = { pathname: "/popular", search: "" };
const page = { products: [], total: 30, page: 2, pageCount: 3 };

function load(query = "") {
  const request = new Request(`http://localhost/popular${query}`);
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  locale.getLocale.mockResolvedValue("en");
  products.getTrioFamilies.mockResolvedValue(["водяні", "квіткові", "свіжі", "фруктові"]);
  products.getPopularPage.mockResolvedValue(page);
});

describe("popular loader", () => {
  it("loads the first page of every popular perfume", async () => {
    expect(await load()).toMatchObject({ total: 30, families: [] });
    expect(products.getPopularPage).toHaveBeenCalledWith([], 1);
  });

  it("passes up to three known families, in pick order, with labels", async () => {
    const query = new URLSearchParams([
      ["family", "свіжі"],
      ["family", "мікс"],
      ["family", "квіткові"],
      ["family", "свіжі"],
      ["family", "водяні"],
      ["family", "фруктові"],
    ]);

    const result = await load(`?${query}`);

    expect(products.getPopularPage).toHaveBeenCalledWith(["свіжі", "квіткові", "водяні"], 1);
    expect(result.families).toEqual([
      { value: "свіжі", label: "Fresh" },
      { value: "квіткові", label: "Floral" },
      { value: "водяні", label: "Aquatic" },
    ]);
  });

  it("reads the page and the families", async () => {
    const result = await load(`?page=2&${new URLSearchParams([["family", "квіткові"]])}`);

    expect(products.getPopularPage).toHaveBeenCalledWith(["квіткові"], 2);
    expect(result.page).toBe(2);
  });

  it("treats an invalid page as the first", async () => {
    products.getPopularPage.mockResolvedValue({ ...page, page: 1 });

    const result = await load("?page=abc");

    expect(products.getPopularPage).toHaveBeenCalledWith([], 1);
    expect(result.page).toBe(1);
  });
});

describe("popular meta", () => {
  it("has a title and description, with or without loader data", () => {
    const tags = meta({
      loaderData: undefined,
      matches: EN,
      location: LOCATION,
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Popular perfumes — Jassmin" });
    expect(tags).toContainEqual({
      name: "description",
      content:
        "The scents Jassmin customers come back for most, picked by our team, in sizes from 5 ml.",
    });
  });

  it("points filtered pages to the unfiltered list, keeping the page number", () => {
    const search = `?${new URLSearchParams([
      ["family", "квіткові"],
      ["page", "2"],
      ["utm_source", "instagram"],
    ])}`;
    const tags = meta({
      matches: EN,
      location: { pathname: "/popular", search },
      loaderData: { ...page, families: [] },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Popular perfumes — Page 2 — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/popular?page=2",
    });
  });

  it("is in Ukrainian by default", () => {
    const tags = meta({
      loaderData: undefined,
      matches: [],
      location: LOCATION,
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Популярні аромати — Jassmin" });
  });
});

describe("popular shouldRevalidate", () => {
  const args = (overrides: Partial<ShouldRevalidateFunctionArgs>) =>
    ({ defaultShouldRevalidate: true, ...overrides }) as ShouldRevalidateFunctionArgs;

  it("doesn't re-rank after adding to the cart", () => {
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/koshyk" }))).toBe(false);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/en/cart" }))).toBe(false);
  });

  it("reloads otherwise", () => {
    expect(shouldRevalidate(args({}))).toBe(true);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/locale" }))).toBe(true);
    expect(shouldRevalidate(args({ defaultShouldRevalidate: false }))).toBe(false);
  });
});
