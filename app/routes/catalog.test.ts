import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ getCatalogPage: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/analytics", () => analytics);

const { loader, shouldRevalidate } = await import("./catalog");

type LoaderArgs = Parameters<typeof loader>[0];

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
