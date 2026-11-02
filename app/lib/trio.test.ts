import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";
import { labelTrioFamilies, parseTrioSearch, toggleTrioFamily, trioHref } from "./trio";

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
    expect(trioHref("uk", ["квіткові", "свіжі"])).toBe(
      `/populiarni?family=${encodeURIComponent("квіткові")}&family=${encodeURIComponent("свіжі")}`,
    );
  });

  it("links to the popular page alone without families", () => {
    expect(trioHref("en", [])).toBe("/en/popular");
  });
});

describe("toggleTrioFamily", () => {
  it("adds a checked family at the end and removes an unchecked one", () => {
    expect(toggleTrioFamily(["квіткові"], "свіжі", true)).toEqual(["квіткові", "свіжі"]);
    expect(toggleTrioFamily(["квіткові", "свіжі"], "квіткові", false)).toEqual(["свіжі"]);
  });

  it("refuses a fourth family and duplicates", () => {
    const full = ["квіткові", "деревні", "свіжі"];
    expect(toggleTrioFamily(full, "східні", true)).toEqual(full);
    expect(toggleTrioFamily(["свіжі"], "свіжі", true)).toEqual(["свіжі"]);
  });
});

describe("labelTrioFamilies", () => {
  it("labels families in the UI's language, alphabetical in it, keeping the stored value", () => {
    expect(labelTrioFamilies(["свіжі", "деревні", "квіткові"], createTranslator("en"))).toEqual([
      { value: "квіткові", label: "Floral" },
      { value: "свіжі", label: "Fresh" },
      { value: "деревні", label: "Woody" },
    ]);
  });

  it("shows a family outside the fixed list as stored", () => {
    expect(labelTrioFamilies(["старі"], createTranslator("en"))).toEqual([
      { value: "старі", label: "старі" },
    ]);
  });
});
