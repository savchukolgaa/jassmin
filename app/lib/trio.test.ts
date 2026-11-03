import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";
import {
  labelTrioFamilies,
  parseTrioGender,
  parseTrioSearch,
  toggleTrioFamily,
  trioHref,
} from "./trio";

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

describe("parseTrioGender", () => {
  const gender = (query: string) => parseTrioGender(new URLSearchParams(query));

  it("reads women or men, trimmed", () => {
    expect(gender("gender=women")).toBe("women");
    expect(gender("gender=men&family=свіжі")).toBe("men");
    expect(gender("gender=%20men%20")).toBe("men");
  });

  it("ignores unknown values and a missing param", () => {
    for (const query of ["", "gender=", "gender=unisex", "gender=WOMEN", "gender=toString"]) {
      expect(gender(query)).toBeNull();
    }
  });
});

describe("trioHref", () => {
  it("links to the popular page with the gender, then each family", () => {
    expect(trioHref("uk", ["квіткові", "свіжі"], "women")).toBe(
      `/populiarni?gender=women&family=${encodeURIComponent("квіткові")}&family=${encodeURIComponent("свіжі")}`,
    );
  });

  it("uses the English path", () => {
    expect(trioHref("en", ["свіжі"], "men")).toBe(
      `/en/popular?gender=men&family=${encodeURIComponent("свіжі")}`,
    );
    expect(trioHref("en", [], "women")).toBe("/en/popular?gender=women");
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
