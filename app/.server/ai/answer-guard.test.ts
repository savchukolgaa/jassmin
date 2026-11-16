import { describe, expect, it } from "vitest";
import {
  cleanProse,
  type GuardContext,
  limitLength,
  MAX_PICKS,
  selectPicks,
  splitSentences,
} from "./answer-guard";
import { AliasMap } from "./catalog-tools";

const catalogNames = [
  "La Vie Est Belle",
  "Lancôme",
  "Sauvage",
  "Dior",
  "Acqua Di Gio",
  "Giorgio Armani",
  "Black Opium",
  "Yves Saint Laurent",
];

const uk: GuardContext = {
  locale: "uk",
  allowedNames: ["La Vie Est Belle", "Lancôme"],
  catalogNames,
};

const en: GuardContext = { ...uk, locale: "en" };

describe("selectPicks", () => {
  it("keeps only aliases the tools handed out, without duplicates, at most 4", () => {
    const aliases = new AliasMap();
    const ids = ["a", "b", "c", "d", "e"].map((x) => aliases.aliasFor(`uuid-${x}`));

    const picks = selectPicks(
      [
        { id: "p99", reason: "invented" },
        { id: ids[0] ?? "", reason: "one" },
        { id: ids[0] ?? "", reason: "again" },
        { id: "3f2c1a00-0000-7000-8000-000000000000", reason: "uuid" },
        ...ids.slice(1).map((id) => ({ id, reason: id })),
      ],
      aliases,
    );

    expect(picks).toHaveLength(MAX_PICKS);
    expect(picks[0]).toEqual({ publicId: "uuid-a", reason: "one" });
    expect(picks.map((p) => p.publicId)).toEqual(["uuid-a", "uuid-b", "uuid-c", "uuid-d"]);
  });
});

describe("splitSentences / limitLength", () => {
  it("splits after . ! ? and …", () => {
    expect(splitSentences("Привіт! Ось варіанти. Подобається? Так…  Добре")).toEqual([
      "Привіт!",
      "Ось варіанти.",
      "Подобається?",
      "Так…",
      "Добре",
    ]);
  });

  it("cuts at a sentence end, else at a word", () => {
    expect(limitLength("Short.", 100)).toBe("Short.");
    expect(limitLength("First sentence here. Second sentence is long.", 30)).toBe(
      "First sentence here.",
    );
    expect(limitLength("one two three four five six", 12)).toBe("one two…");
  });
});

describe("cleanProse", () => {
  it("keeps clean prose and the picks' own names", () => {
    const text = "Ось три квіткові аромати. La Vie Est Belle від Lancôme — солодкий і теплий.";
    expect(cleanProse(text, uk)).toEqual({ text, removed: [] });
  });

  it("removes a sentence naming a catalog perfume or brand outside the picks", () => {
    const result = cleanProse("Раджу ці аромати. Також спробуйте Sauvage від Dior.", uk);
    expect(result.text).toBe("Раджу ці аромати.");
    expect(result.removed).toEqual(["Також спробуйте Sauvage від Dior."]);

    expect(cleanProse("Try these. Black Opium is similar.", en).text).toBe("Try these.");
  });

  it("removes invented names in Ukrainian prose: any Latin word outside the picks", () => {
    const result = cleanProse("Ось варіанти. Aquarius має морські ноти. Blue Marlin свіжий.", uk);
    expect(result.text).toBe("Ось варіанти.");
    expect(result.removed).toHaveLength(2);
    // Bottle types and the shop's name are fine.
    expect(cleanProse("Це EDP на 30 ml від Jassmin.", uk).removed).toEqual([]);
  });

  it("removes invented names in English prose: capitalized runs outside the picks", () => {
    const result = cleanProse(
      "Here are fresh picks. Blue Marlin has sea notes. You may like La Vie Est Belle.",
      en,
    );
    expect(result.text).toBe("Here are fresh picks. You may like La Vie Est Belle.");
    // A capitalized first word alone is fine.
    expect(cleanProse("Bright and floral.", en).removed).toEqual([]);
  });

  it("removes quoted names that aren't picks", () => {
    expect(cleanProse("Схоже на «Морський бриз».", uk).text).toBe("");
    expect(cleanProse('Like "Ocean Dream".', en).text).toBe("");
    expect(cleanProse("Це «La Vie Est Belle».", uk).removed).toEqual([]);
  });

  it("removes ids and prices leaking into the text", () => {
    for (const leak of [
      "Перший (p3) підходить.",
      "Id 0190a1b2-0000-7000-8000-000000000001 is great.",
      "Коштує 1 250 грн.",
      "It costs ₴900.",
      "Only 900 UAH.",
    ]) {
      expect(cleanProse(leak, leak.match(/[а-я]/i) ? uk : en).text).toBe("");
    }
  });
});

describe("cleanProse: English sentence starts", () => {
  it("lets a capitalized first word sit before a pick's name", () => {
    expect(cleanProse("Try La Vie Est Belle tonight.", en).removed).toEqual([]);
  });
});
