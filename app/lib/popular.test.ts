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
  it("is the plain page URL without families or a page", () => {
    expect(popularHref("uk", [])).toBe("/populiarni");
    expect(popularHref("en", [], 1)).toBe("/en/popular");
  });

  it("keeps the families in pick order and adds the page after the first", () => {
    expect(popularHref("uk", ["квіткові", "свіжі"], 2)).toBe(
      `/populiarni?${new URLSearchParams([
        ["family", "квіткові"],
        ["family", "свіжі"],
        ["page", "2"],
      ])}`,
    );
    expect(popularHref("en", [], 3)).toBe("/en/popular?page=3");
  });
});
