import { describe, expect, it } from "vitest";
import {
  type CatalogFixes,
  CatalogParseError,
  catalogPublicId,
  normalizeFamilies,
  normalizeNotes,
  parseCatalogMarkdown,
} from "./parse";

const NO_FIXES: CatalogFixes = { entries: [], familyAliases: {}, noteSpelling: {} };

const FIXES: CatalogFixes = {
  entries: [
    { list: "men", storeCode: "4-Y", sourceTitle: "Spisebomb", title: "Spicebomb" },
    {
      list: "women",
      storeCode: "1-V",
      sourceTitle: "Viktor Rolf Flowerbomb",
      brand: "Viktor&Rolf",
    },
  ],
  familyAliases: { цитрус: "цитрусові", древовидні: "деревні" },
  noteSpelling: { перец: "перець" },
};

/** The owner's list with these lines: women first, then men. */
function list(women: string[], men: string[] = []): string {
  return [
    "Products should be added in catalog.",
    "",
    "**Womens perfume**",
    "",
    ...women.flatMap((line) => [line, ""]),
    "**Mens perfume**",
    "",
    ...men.flatMap((line) => [line, ""]),
  ].join("\n");
}

const LIGHT_BLUE =
  "- **3-D** | **D&G Light Blue** | Dolce & Gabbana | Квіткові, фруктові | Дзвіночок, лимон, зелене яблуко";
const FLOWERBOMB =
  "- **1-V** | **Viktor Rolf Flowerbomb** | Viktor Rolf | Фруктові, квіткові | Бергамот, чай (popular)";
const SPICEBOMB =
  "- **4-Y** | **Spisebomb** | Viktor Rolf | Пряні, древовидні | Бергамот, перец, кориця";

describe("parseCatalogMarkdown", () => {
  it("reads a perfume line into an entry of its list", () => {
    expect(parseCatalogMarkdown(list([LIGHT_BLUE]), NO_FIXES)).toEqual([
      {
        publicId: catalogPublicId("women", "3-D", "D&G Light Blue"),
        list: "women",
        storeCode: "3-D",
        title: "D&G Light Blue",
        brand: "Dolce & Gabbana",
        gender: "women",
        fragranceFamilies: ["квіткові", "фруктові"],
        notes: ["дзвіночок", "лимон", "зелене яблуко"],
        popularRank: null,
      },
    ]);
  });

  it("takes the gender from the list, or unisex from the title in any case", () => {
    const entries = parseCatalogMarkdown(
      list(
        ["- **9-J** | **JPG Gaultier 2 (Unisex)** | Jean Paul Gaultier | Східні | Амбра"],
        [
          "- **9-A** | **Baccarat Rouge 540 (unisex)** | MFK | Східні | Шафран",
          "- **10-A** | **Boss** | Hugo Boss | Деревні | Яблуко",
        ],
      ),
      NO_FIXES,
    );
    expect(entries.map((e) => [e.list, e.title, e.gender])).toEqual([
      ["women", "JPG Gaultier 2", "unisex"],
      ["men", "Baccarat Rouge 540", "unisex"],
      ["men", "Boss", "men"],
    ]);
  });

  it("strips the popular marker from the notes and numbers the popular perfumes in order", () => {
    const entries = parseCatalogMarkdown(
      list([FLOWERBOMB, LIGHT_BLUE], [`${SPICEBOMB} (Popular)`]),
      FIXES,
    );
    expect(entries.map((e) => e.popularRank)).toEqual([1, null, 2]);
    expect(entries[0]?.notes).toEqual(["бергамот", "чай"]);
    expect(entries[2]?.notes).toEqual(["бергамот", "перець", "кориця"]);
  });

  it("applies the fixes without changing the id", () => {
    const [flowerbomb, spicebomb] = parseCatalogMarkdown(list([FLOWERBOMB], [SPICEBOMB]), FIXES);
    expect(flowerbomb).toMatchObject({
      title: "Viktor Rolf Flowerbomb",
      brand: "Viktor&Rolf",
      publicId: catalogPublicId("women", "1-V", "Viktor Rolf Flowerbomb"),
    });
    expect(spicebomb).toMatchObject({
      title: "Spicebomb",
      brand: "Viktor Rolf",
      fragranceFamilies: ["пряні", "деревні"],
      notes: ["бергамот", "перець", "кориця"],
      publicId: catalogPublicId("men", "4-Y", "Spisebomb"),
    });
  });

  it("keeps perfumes that share a code as separate entries", () => {
    const entries = parseCatalogMarkdown(
      list(
        [
          "- **11-L** | **Lolita Lempicka** | Lolita Lempicka | Квіткові | Аніс",
          "- **11-L** | **Lift** | Lolita Lempicka | Квіткові | Вишня",
          "- **3-D** | **D&G Light Blue** | Dolce & Gabbana | Квіткові | Лимон",
        ],
        ["- **3-D** | **D&G Light Blue** | Dolce & Gabbana | Квіткові | Лимон"],
      ),
      NO_FIXES,
    );
    expect(new Set(entries.map((e) => e.publicId)).size).toBe(4);
  });

  it.each([
    ["a line outside the format", "Some text", /Line 5: not a perfume line/],
    ["a line with too few fields", "- **1-A** | **A** | B | Квіткові", /expected 5 fields/],
    [
      "an unknown family",
      "- **1-A** | **A** | B | Мохові | Мох",
      /unknown fragrance family "мохові"/,
    ],
    ["no notes", "- **1-A** | **A** | B | Квіткові | ", /no notes/],
    [
      "a mixed-script word",
      "- **12-O** | **Omnia Bvlgarі** | Bvlgari | Квіткові | Чай",
      /mixes Latin and Cyrillic/,
    ],
  ])("rejects %s", (_, line, message) => {
    expect(() => parseCatalogMarkdown(list([line]), NO_FIXES)).toThrow(CatalogParseError);
    expect(() => parseCatalogMarkdown(list([line]), NO_FIXES)).toThrow(message);
  });

  it("rejects the same perfume twice in one list", () => {
    expect(() => parseCatalogMarkdown(list([LIGHT_BLUE, LIGHT_BLUE]), NO_FIXES)).toThrow(
      /listed twice/,
    );
  });

  it("rejects a fix whose line isn't in the list", () => {
    expect(() => parseCatalogMarkdown(list([LIGHT_BLUE]), FIXES)).toThrow(
      /Fixes for lines that aren't in the list: men 4-Y "Spisebomb", women 1-V/,
    );
  });
});

describe("normalizeFamilies", () => {
  it("lower-cases, aliases and de-duplicates, keeping the order", () => {
    expect(normalizeFamilies("Пряні, пряні, Цитрус", FIXES.familyAliases)).toEqual([
      "пряні",
      "цитрусові",
    ]);
  });
});

describe("normalizeNotes", () => {
  it("trims, lower-cases, respells and de-duplicates", () => {
    expect(
      normalizeNotes(" Перец,  мандарин , Перець, рожевий   перець", FIXES.noteSpelling),
    ).toEqual(["перець", "мандарин", "рожевий перець"]);
  });
});

describe("catalogPublicId", () => {
  it("is a stable version 8 UUID that depends on the list, the code and the title", () => {
    const id = catalogPublicId("women", "3-D", "D&G Light Blue");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(catalogPublicId("women", "3-D", "D&G Light Blue")).toBe(id);
    expect(catalogPublicId("men", "3-D", "D&G Light Blue")).not.toBe(id);
    expect(catalogPublicId("women", "2-D", "D&G Light Blue")).not.toBe(id);
    expect(catalogPublicId("women", "3-D", "D&G Pour Femme")).not.toBe(id);
  });
});
