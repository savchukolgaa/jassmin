import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CATALOG_SORT } from "~/lib/catalog";
import { PERFUME_VOLUMES_ML } from "~/lib/enums";
import { type CatalogEntry, catalogPublicId } from "./catalog/parse";
import { CATALOG_PRODUCTS } from "./catalog-data";
import { CATALOG_DESCRIPTIONS } from "./catalog-descriptions";
import { CATALOG_PRICES } from "./catalog-prices";
import { hasDatabase, type TestDatabase } from "./test-utils";

function entry(
  list: CatalogEntry["list"],
  storeCode: string,
  title: string,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    publicId: catalogPublicId(list, storeCode, title),
    list,
    storeCode,
    title,
    brand: "Brand",
    gender: list,
    fragranceFamilies: ["квіткові", "фруктові"],
    notes: ["лимон", "жасмин"],
    popularRank: null,
    ...extra,
  };
}

// Titles the owner's list doesn't have, so their ids don't clash with `CATALOG_PRODUCTS`.
const LOLITA = entry("women", "11-L", "Test Lolita");
const LIFT = entry("women", "11-L", "Test Lift");
const BACCARAT = entry("men", "9-A", "Test Baccarat", {
  popularRank: 1,
  brand: "Maison Francis Kurkdjian",
  gender: "unisex",
});
const SMALL_LIST = [LOLITA, LIFT, BACCARAT];
const TEST_PRICES = { 10: "240.00", 50: "629.00" };

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("importCatalog", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_import_catalog_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  /** The stored product and its sizes as `[volume, price, stock]`, smallest first. */
  async function stored(publicId: string) {
    const { products, productVariants } = await import("./schema");
    const { asc, eq } = await import("drizzle-orm");
    const [product] = await testDb.db
      .select()
      .from(products)
      .where(eq(products.publicId, publicId));
    if (!product) throw new Error(`Product ${publicId} wasn't imported`);
    const variants = await testDb.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.volumeMl));
    return {
      ...product,
      sizes: variants.map((v) => [v.volumeMl, v.price, v.stockQuantity]),
    };
  }

  it("refuses an empty price table and writes nothing", async () => {
    const { importCatalog } = await import("./import-catalog");
    const { products } = await import("./schema");

    await expect(importCatalog(testDb.db, SMALL_LIST, {})).rejects.toThrow(/no sizes/);
    expect(await testDb.db.$count(products)).toBe(0);
  });

  it("adds each perfume with the table's sizes at stock 0 and queues it for Strapi", async () => {
    const { importCatalog } = await import("./import-catalog");
    const { cmsOutbox } = await import("./schema");

    expect(await importCatalog(testDb.db, SMALL_LIST, TEST_PRICES)).toEqual({
      inserted: 3,
      variantsInserted: 6,
      descriptionsFilled: 0,
      queued: 3,
    });

    const lift = await stored(LIFT.publicId);
    expect(lift).toMatchObject({
      title: "Test Lift",
      storeCode: "11-L",
      gender: "women",
      fragranceFamily: "квіткові",
      fragranceFamilies: ["квіткові", "фруктові"],
      notes: ["лимон", "жасмин"],
      popularRank: null,
      packSize: 1,
      active: true,
      slug: null,
      price: "240.00",
      volumeMl: 10,
      stockQuantity: 0,
    });
    expect(lift.sizes).toEqual([
      [10, "240.00", 0],
      [50, "629.00", 0],
    ]);
    // Both perfumes with code 11-L are in the catalog.
    expect((await stored(LOLITA.publicId)).storeCode).toBe("11-L");
    expect((await stored(BACCARAT.publicId)).popularRank).toBe(1);

    const queued = await testDb.db.select().from(cmsOutbox);
    expect(queued.map((row) => [row.entity, row.syncedAt])).toEqual([
      ["product", null],
      ["product", null],
      ["product", null],
    ]);
  });

  it("lists unisex perfumes in both the women's and the men's catalog", async () => {
    const { getCatalogPage } = await import("../services/products");
    const search = { brand: "Maison Francis Kurkdjian", sort: DEFAULT_CATALOG_SORT, page: 1 };

    for (const gender of ["women", "men"] as const) {
      const page = await getCatalogPage(gender, search, testDb.db);
      expect(page.products.map((p) => p.title)).toEqual(["Test Baccarat"]);
    }
  });

  it("changes nothing on a re-run, keeping what staff changed", async () => {
    const { importCatalog } = await import("./import-catalog");
    const { cmsOutbox, products, productVariants } = await import("./schema");
    const { and, eq, isNull } = await import("drizzle-orm");
    const lift = await stored(LIFT.publicId);
    const lolita = await stored(LOLITA.publicId);

    // Staff edits in Strapi: renamed, other families and code, a popular position, stock and price
    // set, 10 ml deleted, archived.
    await testDb.db
      .update(products)
      .set({
        title: "Test Lift Edition",
        fragranceFamily: "східні",
        fragranceFamilies: ["східні"],
        storeCode: "12-L",
        popularRank: 3,
      })
      .where(eq(products.id, lift.id));
    await testDb.db
      .update(productVariants)
      .set({ stockQuantity: 4, price: "650.00" })
      .where(and(eq(productVariants.productId, lift.id), eq(productVariants.volumeMl, 50)));
    await testDb.db
      .delete(productVariants)
      .where(and(eq(productVariants.productId, lift.id), eq(productVariants.volumeMl, 10)));
    await testDb.db.update(products).set({ active: false }).where(eq(products.id, lolita.id));
    await testDb.db.update(cmsOutbox).set({ syncedAt: new Date() });

    expect(await importCatalog(testDb.db, SMALL_LIST, TEST_PRICES)).toEqual({
      inserted: 0,
      variantsInserted: 0,
      descriptionsFilled: 0,
      queued: 0,
    });

    expect(await testDb.db.$count(products)).toBe(3);
    const after = await stored(LIFT.publicId);
    expect(after).toMatchObject({
      title: "Test Lift Edition",
      fragranceFamilies: ["східні"],
      storeCode: "12-L",
      popularRank: 3,
    });
    expect(after.sizes).toEqual([[50, "650.00", 4]]);
    expect((await stored(LOLITA.publicId)).active).toBe(false);
    expect(await testDb.db.$count(cmsOutbox, isNull(cmsOutbox.syncedAt))).toBe(0);
  });

  it("adds new perfumes with both descriptions (#100)", async () => {
    const { importCatalog } = await import("./import-catalog");
    const fresh = entry("women", "99-T", "Test Described");

    expect(
      await importCatalog(testDb.db, [fresh], TEST_PRICES, {
        [fresh.publicId]: { uk: "Опис українською.", en: "An English description." },
      }),
    ).toMatchObject({ inserted: 1, descriptionsFilled: 0, queued: 1 });
    expect(await stored(fresh.publicId)).toMatchObject({
      description: "Опис українською.",
      descriptionEn: "An English description.",
    });
  });

  it("fills only empty descriptions, one language at a time, and never staff's text (#100)", async () => {
    const { importCatalog } = await import("./import-catalog");
    const { cmsOutbox, products } = await import("./schema");
    const { eq, isNull } = await import("drizzle-orm");
    const descriptions = Object.fromEntries(
      SMALL_LIST.map((e) => [e.publicId, { uk: `Опис ${e.title}.`, en: `About ${e.title}.` }]),
    );
    const [lift, lolita, baccarat] = await Promise.all(
      [LIFT, LOLITA, BACCARAT].map((e) => stored(e.publicId)),
    );
    if (!lift || !lolita || !baccarat) throw new Error("missing product");

    // Staff wrote Lift's Ukrainian only, left Lolita's English blank, and wrote both for Baccarat.
    const staffTime = new Date("2026-01-02T03:04:05Z");
    await testDb.db
      .update(products)
      .set({ description: "  Текст персоналу.  ", descriptionEn: null })
      .where(eq(products.id, lift.id));
    await testDb.db
      .update(products)
      .set({ description: null, descriptionEn: "   " })
      .where(eq(products.id, lolita.id));
    await testDb.db
      .update(products)
      .set({ description: "Свій опис.", descriptionEn: "Our own.", updatedAt: staffTime })
      .where(eq(products.id, baccarat.id));
    await testDb.db.update(cmsOutbox).set({ syncedAt: new Date() });

    expect(await importCatalog(testDb.db, SMALL_LIST, TEST_PRICES, descriptions)).toEqual({
      inserted: 0,
      variantsInserted: 0,
      descriptionsFilled: 2,
      queued: 2,
    });

    expect(await stored(LIFT.publicId)).toMatchObject({
      description: "  Текст персоналу.  ",
      descriptionEn: "About Test Lift.",
    });
    expect(await stored(LOLITA.publicId)).toMatchObject({
      description: "Опис Test Lolita.",
      descriptionEn: "About Test Lolita.",
    });
    expect(await stored(BACCARAT.publicId)).toMatchObject({
      description: "Свій опис.",
      descriptionEn: "Our own.",
      updatedAt: staffTime,
    });
    expect((await stored(LIFT.publicId)).updatedAt.getTime()).toBeGreaterThan(
      lift.updatedAt.getTime(),
    );
    const due = await testDb.db
      .select({ entityId: cmsOutbox.entityId })
      .from(cmsOutbox)
      .where(isNull(cmsOutbox.syncedAt));
    expect(due.map((row) => row.entityId).sort()).toEqual([lift.id, lolita.id].sort());

    await testDb.db.update(cmsOutbox).set({ syncedAt: new Date() });
    expect(await importCatalog(testDb.db, SMALL_LIST, TEST_PRICES, descriptions)).toEqual({
      inserted: 0,
      variantsInserted: 0,
      descriptionsFilled: 0,
      queued: 0,
    });
    expect(await testDb.db.$count(cmsOutbox, isNull(cmsOutbox.syncedAt))).toBe(0);
  });

  it("imports the owner's whole range at the owner's prices", async () => {
    const { importCatalog } = await import("./import-catalog");
    const count = CATALOG_PRODUCTS.length;

    const result = await importCatalog(
      testDb.db,
      CATALOG_PRODUCTS,
      CATALOG_PRICES,
      CATALOG_DESCRIPTIONS,
    );
    expect(result).toEqual({
      inserted: count,
      variantsInserted: count * PERFUME_VOLUMES_ML.length,
      descriptionsFilled: 0,
      queued: count,
    });

    for (const entry of CATALOG_PRODUCTS) {
      const row = await stored(entry.publicId);
      expect(row).toMatchObject({
        title: entry.title,
        brand: entry.brand,
        gender: entry.gender,
        storeCode: entry.storeCode,
        fragranceFamily: entry.fragranceFamilies[0],
        fragranceFamilies: entry.fragranceFamilies,
        notes: entry.notes,
        popularRank: entry.popularRank,
        description: CATALOG_DESCRIPTIONS[entry.publicId]?.uk,
        descriptionEn: CATALOG_DESCRIPTIONS[entry.publicId]?.en,
      });
      expect(row.sizes).toEqual([
        [5, "119.00", 0],
        [10, "240.00", 0],
        [30, "459.00", 0],
        [50, "629.00", 0],
        [100, "969.00", 0],
      ]);
    }

    expect(
      await importCatalog(testDb.db, CATALOG_PRODUCTS, CATALOG_PRICES, CATALOG_DESCRIPTIONS),
    ).toEqual({
      inserted: 0,
      variantsInserted: 0,
      descriptionsFilled: 0,
      queued: 0,
    });
  });
});
