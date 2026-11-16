import { describe, expect, it } from "vitest";
import { FRAGRANCE_FAMILIES } from "~/lib/enums";
import { familiesFor, foldLatin, normalize, resolveFamilies, resolveNotes } from "./synonyms";

describe("normalize", () => {
  it("lowercases, unifies apostrophes and collapses spaces", () => {
    expect(normalize("  М’ята  ПЕРЕЧНА ")).toBe("м'ята перечна");
  });
});

describe("foldLatin", () => {
  it("drops accents and punctuation", () => {
    expect(foldLatin("Lancôme")).toBe("lancome");
    expect(foldLatin("Dolce & Gabbana")).toBe("dolce and gabbana");
    expect(foldLatin("La Vie Est Belle!")).toBe("la vie est belle");
  });
});

describe("familiesFor / resolveFamilies", () => {
  it("knows every family by its own and its English name", () => {
    for (const family of FRAGRANCE_FAMILIES) {
      expect(familiesFor(family)).toEqual([family]);
    }
    expect(familiesFor("Aquatic")).toEqual(["водяні"]);
    expect(familiesFor("fougère")).toEqual(["фужерні"]);
  });

  it("maps the synonyms from the feasibility test", () => {
    expect(familiesFor("морські")).toEqual(["водяні"]);
    expect(familiesFor("морські ноти")).toEqual(["водяні"]);
    expect(familiesFor("свіжий")).toEqual(["свіжі", "цитрусові"]);
    expect(familiesFor("солодкі")).toEqual(["гурманські", "ванільні"]);
    expect(familiesFor("spicy oriental")).toEqual(["пряні", "східні"]);
    expect(familiesFor("marine notes")).toEqual(["водяні"]);
  });

  it("matches Ukrainian inflections by stem", () => {
    expect(familiesFor("квітковий")).toEqual(["квіткові"]);
    expect(familiesFor("деревних")).toEqual(["деревні"]);
  });

  it("ignores words that mean no family and removes duplicates", () => {
    expect(familiesFor("фіталіс")).toEqual([]);
    expect(resolveFamilies(["oriental", "spicy", "фіталіс", "східні"])).toEqual([
      "східні",
      "пряні",
    ]);
  });
});

describe("resolveNotes", () => {
  it("maps English notes and the catalog's own variants", () => {
    expect(resolveNotes(["Rose", "vanilla"]).notes).toEqual(["троянда", "роза", "ваніль"]);
    expect(resolveNotes(["роза"]).notes).toEqual(["троянда", "роза"]);
  });

  it("treats a family passed as a note as a family too", () => {
    expect(resolveNotes(["морська вода"])).toEqual({
      notes: ["морська вода"],
      families: ["водяні"],
    });
    expect(resolveNotes(["свіжі", "жасмин"])).toEqual({
      notes: ["свіжі", "жасмин"],
      families: ["свіжі"],
    });
  });

  it("skips blank notes", () => {
    expect(resolveNotes(["  "])).toEqual({ notes: [], families: [] });
  });
});
