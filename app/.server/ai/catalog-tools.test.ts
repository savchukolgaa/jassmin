import { describe, expect, it } from "vitest";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import {
  AliasMap,
  findByTitle,
  runCatalogTool,
  searchCatalog,
  similarInCatalog,
} from "./catalog-tools";

let next = 0;

function product(title: string, overrides: Partial<PerfumerProductRow> = {}): PerfumerProductRow {
  next += 1;
  return {
    publicId: `00000000-0000-7000-8000-${String(next).padStart(12, "0")}`,
    title,
    brand: "House",
    gender: "women",
    fragranceFamilies: [],
    notes: [],
    popularRank: null,
    active: true,
    sizes: [{ ml: 30, price: "900.00" }],
    ...overrides,
  };
}

const laVie = product("La Vie Est Belle", {
  brand: "Lancôme",
  fragranceFamilies: ["фруктові", "квіткові"],
  notes: ["чорна смородина", "груша", "ірис", "жасмин", "пралине", "ваніль"],
});
const aqua = product("Acqua Di Gio", {
  brand: "Giorgio Armani",
  gender: "men",
  fragranceFamilies: ["водяні", "цитрусові"],
  notes: ["морські ноти", "бергамот", "жасмин"],
  popularRank: 2,
});
const blossom = product("Fruity Blossom", {
  fragranceFamilies: ["квіткові", "фруктові"],
  notes: ["персик", "чорна смородина", "троянда"],
  popularRank: 1,
});
const floral = product("Only Floral", {
  fragranceFamilies: ["квіткові"],
  notes: ["півонія"],
  sizes: [
    { ml: 30, price: "700.00" },
    { ml: 50, price: "1500.00" },
  ],
});
const vanilla = product("Vanilla Sky", {
  gender: "unisex",
  fragranceFamilies: ["ванільні", "гурманські"],
  notes: ["ваніль", "карамель"],
});
const archived = product("Archived Rose", {
  active: false,
  fragranceFamilies: ["квіткові"],
  notes: ["троянда"],
});
const soldOut = product("Sold Out Rose", {
  fragranceFamilies: ["квіткові"],
  notes: ["троянда"],
  sizes: [],
});
const woody = product("Cedar Man", {
  gender: "men",
  fragranceFamilies: ["деревні"],
  notes: ["білий кедр", "ветивер"],
});

const catalog = [laVie, aqua, blossom, floral, vanilla, archived, soldOut, woody];

const titles = (products: readonly PerfumerProductRow[]) => products.map((p) => p.title);

describe("searchCatalog", () => {
  it("leaves out archived products and products with nothing in stock", () => {
    const { products } = searchCatalog(catalog, { notes: ["троянда"] });
    expect(titles(products)).toContain("Fruity Blossom");
    expect(titles(products)).not.toContain("Archived Rose");
    expect(titles(products)).not.toContain("Sold Out Rose");
  });

  it("filters by gender, unisex included", () => {
    expect(titles(searchCatalog(catalog, { gender: "men" }).products).sort()).toEqual([
      "Acqua Di Gio",
      "Cedar Man",
      "Vanilla Sky",
    ]);
  });

  it("finds aquatic perfumes for 'морські ноти' and its synonyms", () => {
    for (const args of [
      { notes: ["морські ноти"] },
      { families: ["морські"] },
      { notes: ["морська вода"] },
      { families: ["aquatic"] },
    ]) {
      expect(titles(searchCatalog(catalog, args).products)[0]).toBe("Acqua Di Gio");
    }
  });

  it("matches notes by substring", () => {
    const result = searchCatalog(catalog, { notes: ["кедр"] });
    expect(result.match).toBe("notes");
    expect(titles(result.products)).toEqual(["Cedar Man"]);
  });

  it("falls back to families when the notes match nothing", () => {
    const result = searchCatalog(catalog, { families: ["солодкі"], notes: ["фіталіс"] });
    expect(result.match).toBe("families");
    expect(titles(result.products)).toEqual(["Vanilla Sky"]);
  });

  it("returns nothing when neither notes nor families match", () => {
    expect(searchCatalog(catalog, { notes: ["фіталіс"] })).toEqual({
      match: "nothing",
      products: [],
    });
  });

  it("keeps only the sizes within the budget and drops products without one", () => {
    const { products } = searchCatalog(catalog, { families: ["квіткові"], max_price_uah: 800 });
    expect(titles(products)).toEqual(["Only Floral"]);
    expect(products[0]?.sizes).toEqual([{ ml: 30, price: "700.00" }]);
  });

  it("ranks by matches, then staff's popular order, and honours the limit", () => {
    const { products } = searchCatalog(catalog, {
      families: ["квіткові", "фруктові"],
      limit: 2,
    });
    // Both have two families; Fruity Blossom is popular_rank 1.
    expect(titles(products)).toEqual(["Fruity Blossom", "La Vie Est Belle"]);
  });

  it("lists popular perfumes when no families or notes are given", () => {
    const result = searchCatalog(catalog, { gender: "women", limit: 1 });
    expect(result.match).toBe("any");
    expect(titles(result.products)).toEqual(["Fruity Blossom"]);
  });
});

describe("findByTitle", () => {
  it("finds a perfume by its title, with or without the brand, ignoring case and accents", () => {
    for (const query of [
      "La Vie Est Belle",
      "la vie est belle",
      "Lancome La Vie Est Belle",
      "La Vie Est Belle Lancôme",
      "la vie",
    ]) {
      expect(findByTitle(catalog, query)?.title).toBe("La Vie Est Belle");
    }
  });

  it("returns undefined for an unknown perfume", () => {
    expect(findByTitle(catalog, "Baccarat Rouge 540")).toBeUndefined();
  });
});

describe("similarInCatalog", () => {
  it("finds fruity/floral perfumes like La Vie Est Belle, without itself", () => {
    const result = similarInCatalog(catalog, { title: "схоже на La Vie Est Belle" });
    expect(result.reference?.title).toBe("La Vie Est Belle");
    expect(titles(result.products)[0]).toBe("Fruity Blossom");
    expect(titles(result.products)).not.toContain("La Vie Est Belle");
    for (const found of result.products) {
      expect(
        found.fragranceFamilies.some((f) => f === "фруктові" || f === "квіткові") ||
          found.notes.length > 0,
      ).toBe(true);
    }
  });

  it("starts from an archived reference too", () => {
    expect(similarInCatalog(catalog, { title: "Archived Rose" }).reference?.title).toBe(
      "Archived Rose",
    );
  });
});

describe("runCatalogTool", () => {
  it("returns compact rows with per-reply aliases and records the call", () => {
    const aliases = new AliasMap();
    const run = runCatalogTool(catalog, "search_perfumes", '{"notes":["кедр"]}', aliases);

    expect(JSON.parse(run.content)).toEqual({
      match: expect.any(String),
      perfumes: [
        {
          id: "p1",
          title: "Cedar Man",
          brand: "House",
          gender: "men",
          families: ["деревні"],
          notes: ["білий кедр", "ветивер"],
          sizes: [{ ml: 30, price_uah: 900 }],
        },
      ],
    });
    expect(run.record).toMatchObject({ ok: true, match: "notes", resultIds: ["p1"] });
    expect(aliases.publicIdFor("p1")).toBe(woody.publicId);
    expect(aliases.publicIdFor("P1")).toBe(woody.publicId);
    expect(aliases.publicIdFor("p2")).toBeUndefined();
  });

  it("keeps an alias stable across calls in one reply", () => {
    const aliases = new AliasMap();
    runCatalogTool(catalog, "search_perfumes", '{"notes":["кедр"]}', aliases);
    runCatalogTool(catalog, "search_perfumes", '{"gender":"men"}', aliases);
    expect(aliases.publicIdFor("p1")).toBe(woody.publicId);
  });

  it("forgives null, comma-separated lists and gender words", () => {
    const run = runCatalogTool(
      catalog,
      "search_perfumes",
      '{"gender":"female","families":"квіткові, фруктові","notes":null,"max_price_uah":"1000","limit":null}',
      new AliasMap(),
    );
    expect(run.record.ok).toBe(true);
    expect(run.record.arguments).toEqual({
      gender: "women",
      families: ["квіткові", "фруктові"],
      max_price_uah: 1000,
    });
  });

  it("reports invalid arguments, bad JSON and unknown tools to the model without throwing", () => {
    const aliases = new AliasMap();
    for (const [name, args] of [
      ["search_perfumes", '{"limit": 50}'],
      ["search_perfumes", '{"max_price_uah": -5}'],
      ["similar_to", "{}"],
      ["search_perfumes", "{not json"],
      ["add_to_cart", "{}"],
    ] as const) {
      const run = runCatalogTool(catalog, name, args, aliases);
      expect(run.record.ok).toBe(false);
      expect(JSON.parse(run.content)).toHaveProperty("error");
    }
    expect(aliases.size).toBe(0);
  });

  it("answers similar_to for an unknown perfume with a hint", () => {
    const run = runCatalogTool(catalog, "similar_to", '{"title":"Baccarat Rouge"}', new AliasMap());
    expect(JSON.parse(run.content)).toMatchObject({ reference: null, perfumes: [] });
  });
});
