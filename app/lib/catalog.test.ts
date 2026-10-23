import { describe, expect, it } from "vitest";
import {
  type CatalogSearch,
  catalogHref,
  hasActiveFilters,
  isCatalogGender,
  parseCatalogSearch,
} from "./catalog";

const parse = (query: string) => parseCatalogSearch(new URLSearchParams(query));

const DEFAULTS: CatalogSearch = {
  fragranceFamily: undefined,
  brand: undefined,
  sort: "newest",
  page: 1,
};

describe("isCatalogGender", () => {
  it("accepts only the men's and women's catalogs", () => {
    expect(isCatalogGender("men")).toBe(true);
    expect(isCatalogGender("women")).toBe(true);
    expect(isCatalogGender("unisex")).toBe(false);
    expect(isCatalogGender("toString")).toBe(false);
  });
});

describe("parseCatalogSearch", () => {
  it("uses the defaults without search params", () => {
    expect(parse("")).toEqual(DEFAULTS);
  });

  it("reads every filter", () => {
    expect(parse("fragrance_family=деревні&brand=Dior&sort=price_asc&page=3")).toEqual({
      fragranceFamily: "деревні",
      brand: "Dior",
      sort: "price_asc",
      page: 3,
    });
  });

  it("falls back to defaults for invalid values", () => {
    for (const page of ["abc", "0", "-1", "1.5", "99999"]) {
      expect(parse(`page=${page}`).page).toBe(1);
    }
    expect(parse("sort=cheapest").sort).toBe("newest");
  });

  it("treats empty and blank filters as no filter", () => {
    expect(parse("brand=&fragrance_family=%20%20")).toEqual(DEFAULTS);
  });

  it("trims filters and drops over-long ones", () => {
    expect(parse("brand=%20Dior%20").brand).toBe("Dior");
    expect(parse(`brand=${"x".repeat(256)}`).brand).toBeUndefined();
  });
});

describe("hasActiveFilters", () => {
  it("is false for the default catalog, even on a later page", () => {
    expect(hasActiveFilters({ ...DEFAULTS, page: 2 })).toBe(false);
  });

  it("is true when a filter or a non-default sort is set", () => {
    expect(hasActiveFilters({ ...DEFAULTS, brand: "Dior" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULTS, sort: "price_desc" })).toBe(true);
  });
});

describe("catalogHref", () => {
  it("omits defaults", () => {
    expect(catalogHref("/catalog/men", DEFAULTS, 1)).toBe("/catalog/men");
  });

  it("keeps the filters and sets the page", () => {
    const search = { ...DEFAULTS, brand: "Jo Malone London", sort: "price_desc" as const };

    expect(catalogHref("/catalog/women", search, 2)).toBe(
      "/catalog/women?brand=Jo+Malone+London&sort=price_desc&page=2",
    );
  });
});
