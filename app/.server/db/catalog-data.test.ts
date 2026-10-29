import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_NOTES } from "~/lib/cms-sync";
import { FRAGRANCE_FAMILIES, PERFUME_VOLUMES_ML } from "~/lib/enums";
import { CATALOG_PRODUCTS } from "./catalog-data";
import { CATALOG_PRICES } from "./catalog-prices";

const byCode = (list: string, storeCode: string) =>
  CATALOG_PRODUCTS.filter((p) => p.list === list && p.storeCode === storeCode);

describe("CATALOG_PRODUCTS", () => {
  it("has every perfume of the owner's list", () => {
    expect(CATALOG_PRODUCTS.filter((p) => p.list === "women")).toHaveLength(75);
    expect(CATALOG_PRODUCTS.filter((p) => p.list === "men")).toHaveLength(53);
    const ranks = CATALOG_PRODUCTS.flatMap((p) => (p.popularRank === null ? [] : [p.popularRank]));
    expect(ranks).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(CATALOG_PRODUCTS.find((p) => p.popularRank === 1)?.title).toBe("La Vie Est Belle");
    expect(CATALOG_PRODUCTS.find((p) => p.popularRank === 30)?.title).toBe("Molecule 02");
  });

  it("gives every perfume its own id, including perfumes that share a code", () => {
    expect(new Set(CATALOG_PRODUCTS.map((p) => p.publicId)).size).toBe(CATALOG_PRODUCTS.length);
    expect(new Set(CATALOG_PRODUCTS.map((p) => `${p.list} ${p.storeCode} ${p.title}`)).size).toBe(
      CATALOG_PRODUCTS.length,
    );
    expect(byCode("women", "11-L").map((p) => p.title)).toEqual(["Lolita Lempicka", "Lift"]);
    expect(byCode("women", "15-D")).toHaveLength(1);
    expect(byCode("women", "14-Z")).toHaveLength(1);
    expect(byCode("men", "3-D")).toHaveLength(1);
    expect(byCode("women", "3-D")).toHaveLength(1);
  });

  it("has one to many valid families and notes per perfume", () => {
    for (const product of CATALOG_PRODUCTS) {
      expect(product.fragranceFamilies.length, product.title).toBeGreaterThan(0);
      expect(new Set(product.fragranceFamilies).size, product.title).toBe(
        product.fragranceFamilies.length,
      );
      for (const family of product.fragranceFamilies) {
        expect(FRAGRANCE_FAMILIES, product.title).toContain(family);
      }
      expect(product.notes.length, product.title).toBeGreaterThan(0);
      expect(product.notes.length, product.title).toBeLessThanOrEqual(MAX_PRODUCT_NOTES);
      expect(new Set(product.notes).size, product.title).toBe(product.notes.length);
    }
  });

  it("marks unisex perfumes without the marker in the title, and the rest by their list", () => {
    for (const product of CATALOG_PRODUCTS) {
      expect(product.title).not.toMatch(/unisex|popular/i);
      expect(product.notes.join(" ")).not.toMatch(/popular/i);
      if (product.gender !== "unisex") {
        expect(product.gender, product.title).toBe(product.list);
      }
    }
    expect(byCode("men", "9-A")[0]).toMatchObject({
      title: "Baccarat Rouge 540",
      gender: "unisex",
    });
    expect(CATALOG_PRODUCTS.filter((p) => p.gender === "unisex")).toHaveLength(11);
  });

  it("tells same-name perfumes apart by title", () => {
    for (const gender of ["women", "men", "unisex"]) {
      const titles = CATALOG_PRODUCTS.filter((p) => p.gender === gender).map((p) => p.title);
      expect(new Set(titles).size, gender).toBe(titles.length);
    }
    expect(byCode("women", "2-H")[0]?.title).toBe("Hugo Boss Woman");
    expect(byCode("men", "1-H")[0]?.title).toBe("Hugo Boss Man");
  });

  it("fits the product columns", () => {
    for (const product of CATALOG_PRODUCTS) {
      expect(product.storeCode.length).toBeLessThanOrEqual(20);
      expect(product.title.length).toBeLessThanOrEqual(255);
      expect(product.brand.length).toBeLessThanOrEqual(255);
    }
  });
});

describe("CATALOG_PRICES", () => {
  it("prices every size the shop sells", () => {
    expect(Object.keys(CATALOG_PRICES).map(Number)).toEqual([...PERFUME_VOLUMES_ML]);
    for (const price of Object.values(CATALOG_PRICES)) {
      expect(price).toMatch(/^\d+\.\d{2}$/);
      expect(Number(price)).toBeGreaterThan(0);
    }
  });
});
