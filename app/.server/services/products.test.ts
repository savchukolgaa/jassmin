import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSearch } from "~/lib/catalog";
import { SAMPLE_PRODUCTS } from "../db/seed-data";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

const DEFAULTS: CatalogSearch = { sort: "newest", page: 1 };

const titlesOf = (genders: string[]) =>
  SAMPLE_PRODUCTS.filter((p) => genders.includes(p.gender)).map((p) => p.title);

// Extra women's products, so the women's catalog has more than one page.
const PAGING_BRAND = "Paging House";
const PAGING_COUNT = 13;

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("products service", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    const { products } = await import("../db/schema");
    testDb = await createTestDatabase("jassmin_products_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    await testDb.db.insert(products).values(
      Array.from({ length: PAGING_COUNT }, (_, i) => ({
        title: `Paging ${i}`,
        brand: PAGING_BRAND,
        gender: "women" as const,
        price: `${100 + i}.00`,
        volumeMl: 30,
      })),
    );
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  const catalog = async (gender: "men" | "women", search: Partial<CatalogSearch> = {}) => {
    const { getCatalogPage } = await import("./products");
    return getCatalogPage(gender, { ...DEFAULTS, ...search }, testDb.db);
  };

  it("lists men's and unisex products in the men's catalog", async () => {
    const page = await catalog("men");

    expect(page.products.map((p) => p.title).sort()).toEqual(titlesOf(["men", "unisex"]).sort());
    expect(page.total).toBe(page.products.length);
    expect(page.pageCount).toBe(1);
  });

  it("lists only women's and unisex products in the women's catalog", async () => {
    const page = await catalog("women");
    const all = [...page.products, ...(await catalog("women", { page: 2 })).products];

    expect(new Set(all.map((p) => p.gender))).toEqual(new Set(["women", "unisex"]));
    expect(all.map((p) => p.title)).toEqual(expect.arrayContaining(titlesOf(["women", "unisex"])));
    expect(page.total).toBe(titlesOf(["women", "unisex"]).length + PAGING_COUNT);
  });

  it("filters by brand and fragrance family", async () => {
    expect((await catalog("men", { brand: "Dior" })).products.map((p) => p.title)).toEqual([
      "Sauvage Eau de Toilette",
    ]);
    const woody = await catalog("men", { fragranceFamily: "деревні" });
    expect(woody.products.map((p) => p.title).sort()).toEqual(
      SAMPLE_PRODUCTS.filter((p) => p.fragranceFamily === "деревні" && p.gender !== "women")
        .map((p) => p.title)
        .sort(),
    );
    expect((await catalog("men", { brand: "Nobody" })).products).toEqual([]);
  });

  it("sorts by price and by newest", async () => {
    const prices = (await catalog("men", { sort: "price_asc" })).products.map((p) =>
      Number(p.price),
    );
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const desc = (await catalog("men", { sort: "price_desc" })).products.map((p) => p.price);
    expect(desc).toEqual(
      (await catalog("men", { sort: "price_asc" })).products.map((p) => p.price).reverse(),
    );

    // Seeded together, so the newest is the last inserted.
    const newest = await catalog("men");
    expect(newest.products[0]?.title).toBe(titlesOf(["men", "unisex"]).at(-1));
  });

  it("paginates", async () => {
    const first = await catalog("women", { brand: PAGING_BRAND });
    const second = await catalog("women", { brand: PAGING_BRAND, page: 2 });
    const beyond = await catalog("women", { brand: PAGING_BRAND, page: 3 });

    expect(first.products).toHaveLength(12);
    expect(second.products).toHaveLength(1);
    expect(first.pageCount).toBe(2);
    expect(beyond.products).toEqual([]);
    expect(beyond.total).toBe(PAGING_COUNT);
  });

  it("offers the brands and families of the catalog's genders", async () => {
    const { filterOptions } = await catalog("men");
    const scoped = SAMPLE_PRODUCTS.filter((p) => p.gender !== "women");

    expect(filterOptions.brands).toEqual([...new Set(scoped.map((p) => p.brand))].sort());
    expect(filterOptions.fragranceFamilies.sort()).toEqual(
      [...new Set(scoped.map((p) => p.fragranceFamily ?? ""))].sort(),
    );
  });

  it("returns a product's details by public id", async () => {
    const { getProduct } = await import("./products");
    const sauvage = SAMPLE_PRODUCTS.find((p) => p.title.startsWith("Sauvage"));

    expect(await getProduct(sauvage?.publicId ?? "", testDb.db)).toEqual({
      id: sauvage?.publicId,
      title: "Sauvage Eau de Toilette",
      brand: "Dior",
      gender: "men",
      price: "4450.00",
      volumeMl: 100,
      packSize: 1,
      imageUrl: null,
      inStock: true,
      description: sauvage?.description,
      fragranceFamily: "фужерні",
      stockQuantity: 12,
    });
  });

  it("returns null for an unknown public id", async () => {
    const { getProduct } = await import("./products");

    expect(await getProduct("01a1652b-6e25-7c00-8000-000000000000", testDb.db)).toBeNull();
  });
});
