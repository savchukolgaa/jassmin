import { describe, expect, it } from "vitest";
import { parsePopularPage, popularHref } from "./popular";

describe("parsePopularPage", () => {
  it("reads a whole page number from 1", () => {
    expect(parsePopularPage(new URLSearchParams("page=3"))).toBe(3);
  });

  it("falls back to 1 when missing or invalid", () => {
    for (const query of ["", "page=0", "page=-2", "page=1.5", "page=abc", "page=99999"]) {
      expect(parsePopularPage(new URLSearchParams(query))).toBe(1);
    }
  });
});

describe("popularHref", () => {
  it("is /popular without families or a page", () => {
    expect(popularHref([])).toBe("/popular");
    expect(popularHref([], 1)).toBe("/popular");
  });

  it("keeps the families in pick order and adds the page after the first", () => {
    expect(popularHref(["квіткові", "свіжі"], 2)).toBe(
      `/popular?${new URLSearchParams([
        ["family", "квіткові"],
        ["family", "свіжі"],
        ["page", "2"],
      ])}`,
    );
    expect(popularHref([], 3)).toBe("/popular?page=3");
  });
});
