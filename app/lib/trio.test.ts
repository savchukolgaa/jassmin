import { describe, expect, it } from "vitest";
import { parseTrioSearch, trioHref } from "./trio";

const known = ["квіткові", "деревні", "свіжі", "східні"];

function parse(query: string) {
  return parseTrioSearch(new URLSearchParams(query), known);
}

describe("parseTrioSearch", () => {
  it("keeps known families in the order they were picked", () => {
    expect(parse("family=деревні&family=квіткові")).toEqual(["деревні", "квіткові"]);
  });

  it("drops unknown values, blanks and duplicates, and trims", () => {
    expect(parse("family=%20свіжі%20&family=unknown&family=&family=свіжі")).toEqual(["свіжі"]);
  });

  it("takes at most three families", () => {
    expect(parse("family=квіткові&family=деревні&family=свіжі&family=східні")).toEqual([
      "квіткові",
      "деревні",
      "свіжі",
    ]);
  });

  it("is empty without picks", () => {
    expect(parse("")).toEqual([]);
  });
});

describe("trioHref", () => {
  it("links to the popular page with each family", () => {
    expect(trioHref(["квіткові", "свіжі"])).toBe(
      `/popular?family=${encodeURIComponent("квіткові")}&family=${encodeURIComponent("свіжі")}`,
    );
  });

  it("links to the popular page alone without families", () => {
    expect(trioHref([])).toBe("/popular");
  });
});
