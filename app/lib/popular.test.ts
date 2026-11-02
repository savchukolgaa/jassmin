import { describe, expect, it } from "vitest";
import { popularHref } from "./popular";
import { parsePopularPage } from "./popular.schema";

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
  const all = { families: [], gender: null };

  it("is the plain page URL without a filter or a page", () => {
    expect(popularHref("uk", all)).toBe("/populiarni");
    expect(popularHref("en", all, 1)).toBe("/en/popular");
  });

  it("keeps the families in pick order and adds the page after the first", () => {
    expect(popularHref("uk", { families: ["квіткові", "свіжі"], gender: null }, 2)).toBe(
      `/populiarni?${new URLSearchParams([
        ["family", "квіткові"],
        ["family", "свіжі"],
        ["page", "2"],
      ])}`,
    );
    expect(popularHref("en", all, 3)).toBe("/en/popular?page=3");
  });

  it("puts the gender first, then the families, then the page (#102)", () => {
    expect(popularHref("en", { families: [], gender: "men" })).toBe("/en/popular?gender=men");
    expect(popularHref("uk", { families: ["свіжі", "деревні"], gender: "women" }, 2)).toBe(
      `/populiarni?${new URLSearchParams([
        ["gender", "women"],
        ["family", "свіжі"],
        ["family", "деревні"],
        ["page", "2"],
      ])}`,
    );
  });
});
