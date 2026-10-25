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

// A men's product without variants: it has nothing for sale, so it's never listed.
const UNSOLD_BRAND = "Unsold House";

const sampleNamed = (prefix: string) => {
  const product = SAMPLE_PRODUCTS.find((p) => p.title.startsWith(prefix));
  if (!product) throw new Error(`No sample product ${prefix}`);
  return product;
};

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("products service", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    const { productVariants, products } = await import("../db/schema");
    testDb = await createTestDatabase("jassmin_products_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
    const paging = await testDb.db
      .insert(products)
      .values(
        Array.from({ length: PAGING_COUNT }, (_, i) => ({
          title: `Paging ${i}`,
          brand: PAGING_BRAND,
          gender: "women" as const,
          price: `${100 + i}.00`,
          volumeMl: 30,
        })),
      )
      .returning({ id: products.id });
    await testDb.db
      .insert(productVariants)
      .values(paging.map(({ id }, i) => ({ productId: id, volumeMl: 30, price: `${100 + i}.00` })));
    await testDb.db.insert(products).values({
      title: "Unsold",
      brand: UNSOLD_BRAND,
      gender: "men",
      price: "1.00",
      volumeMl: 75,
    });
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

  it("sorts by the lowest variant price and by newest", async () => {
    const prices = (await catalog("men", { sort: "price_asc" })).products.map((p) =>
      Number(p.minPrice),
    );
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const desc = (await catalog("men", { sort: "price_desc" })).products.map((p) => p.minPrice);
    expect(desc).toEqual(
      (await catalog("men", { sort: "price_asc" })).products.map((p) => p.minPrice).reverse(),
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

  it("summarises each product's variants on its card", async () => {
    const { products } = await catalog("men", { brand: "Giorgio Armani" });
    const [acqua] = products;

    // Sold out in every size: listed, out of stock, and the default is the smallest size.
    expect(acqua).toMatchObject({
      minPrice: "1990.00",
      hasPriceRange: true,
      volumes: [30, 100],
      inStock: false,
      defaultVariant: { id: expect.any(String), volumeMl: 30 },
    });

    const coco = (await catalog("women", { brand: "Chanel" })).products[0];
    // 7 ml is the smallest size in stock (10 ml is sold out).
    expect(coco).toMatchObject({
      minPrice: "990.00",
      hasPriceRange: true,
      volumes: [7, 10, 30, 50, 100],
      inStock: true,
      defaultVariant: { volumeMl: 7 },
    });

    const testers = (await catalog("women", { brand: "Jassmin" })).products[0];
    expect(testers).toMatchObject({ hasPriceRange: false, volumes: [10], packSize: 3 });
  });

  it("doesn't list products without variants", async () => {
    const page = await catalog("men", { brand: UNSOLD_BRAND });

    expect(page.products).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.filterOptions.brands).not.toContain(UNSOLD_BRAND);
  });

  it("returns a product's details with its variants by public id, smallest first", async () => {
    const { getProduct } = await import("./products");
    const sauvage = sampleNamed("Sauvage");

    expect(await getProduct(sauvage.publicId, testDb.db)).toEqual({
      id: sauvage.publicId,
      title: "Sauvage Eau de Toilette",
      brand: "Dior",
      gender: "men",
      packSize: 1,
      imageUrl: null,
      description: sauvage.description,
      fragranceFamily: "фужерні",
      variants: [
        { id: expect.any(String), volumeMl: 10, price: "790.00", stockQuantity: 15, inStock: true },
        { id: expect.any(String), volumeMl: 50, price: "3290.00", stockQuantity: 6, inStock: true },
        {
          id: expect.any(String),
          volumeMl: 100,
          price: "4450.00",
          stockQuantity: 12,
          inStock: true,
        },
      ],
    });
  });

  it("checks that a variant belongs to the product and is in stock", async () => {
    const { checkVariantForCart, getProduct } = await import("./products");
    const coco = await getProduct(sampleNamed("Coco").publicId, testDb.db);
    const sauvage = await getProduct(sampleNamed("Sauvage").publicId, testDb.db);
    const size = (volumeMl: number) => coco?.variants.find((v) => v.volumeMl === volumeMl)?.id;
    const check = (variantId: string | undefined, productId = coco?.id) =>
      checkVariantForCart(productId ?? "", variantId ?? "", testDb.db);

    expect(await check(size(50))).toEqual({
      ok: true,
      variant: expect.objectContaining({ volumeMl: 50, price: "6850.00", stockQuantity: 6 }),
    });
    expect(await check(size(10))).toEqual({ ok: false, error: "out-of-stock" });
    expect(await check(sauvage?.variants[0]?.id)).toEqual({ ok: false, error: "invalid-variant" });
    expect(await check("01a1652b-6e25-7c00-8000-000000000000")).toEqual({
      ok: false,
      error: "invalid-variant",
    });
    expect(await check(size(50), "01a1652b-6e25-7c00-8000-000000000000")).toEqual({
      ok: false,
      error: "invalid-variant",
    });
  });

  it("returns null for an unknown public id", async () => {
    const { getProduct, getProductWithId } = await import("./products");

    expect(await getProduct("01a1652b-6e25-7c00-8000-000000000000", testDb.db)).toBeNull();
    expect(await getProductWithId("01a1652b-6e25-7c00-8000-000000000000", testDb.db)).toBeNull();
  });

  it("gives the server the serial id next to the product", async () => {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const { getProduct, getProductWithId } = await import("./products");
    const sauvage = sampleNamed("Sauvage");
    const [row] = await testDb.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.publicId, sauvage.publicId));

    expect(await getProductWithId(sauvage.publicId, testDb.db)).toEqual({
      id: row?.id,
      product: await getProduct(sauvage.publicId, testDb.db),
    });
  });

  it("looks up product cards by public id, skipping unknown and unsold products", async () => {
    const { getProductSummaries } = await import("./products");
    const { products } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [unsold] = await testDb.db
      .select({ publicId: products.publicId })
      .from(products)
      .where(eq(products.brand, UNSOLD_BRAND));
    const coco = sampleNamed("Coco");
    const sauvage = sampleNamed("Sauvage");
    const unknown = "01a1652b-6e25-7fff-8000-000000000000";

    const found = await getProductSummaries(
      [sauvage.publicId, unknown, coco.publicId, unsold?.publicId ?? unknown, coco.publicId],
      testDb.db,
    );

    expect([...found.keys()].sort()).toEqual([coco.publicId, sauvage.publicId].sort());
    expect(found.get(coco.publicId)).toMatchObject({
      id: coco.publicId,
      title: coco.title,
      brand: coco.brand,
      minPrice: "990.00",
      hasPriceRange: true,
      volumes: [7, 10, 30, 50, 100],
      inStock: true,
      defaultVariant: { volumeMl: 7 },
    });
  });

  it("doesn't query for an empty list of ids", async () => {
    const { getProductSummaries } = await import("./products");

    expect((await getProductSummaries([], testDb.db)).size).toBe(0);
  });
});
