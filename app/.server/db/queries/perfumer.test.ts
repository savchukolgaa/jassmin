import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("listPerfumerProducts (#162)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_perfumer_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { products } = await import("../schema");
    await testDb.db.delete(products);
  });

  async function product(
    title: string,
    sizes: { ml: number; price: string; stock?: number; tracked?: boolean }[],
    options: { active?: boolean; families?: string[]; notes?: string[]; rank?: number } = {},
  ) {
    const { products, productVariants } = await import("../schema");
    const [row] = await testDb.db
      .insert(products)
      .values({
        title,
        brand: "House",
        gender: "women",
        fragranceFamily: options.families?.[0] ?? null,
        fragranceFamilies: options.families ?? [],
        notes: options.notes ?? [],
        popularRank: options.rank ?? null,
        price: "100.00",
        volumeMl: 30,
        active: options.active ?? true,
      })
      .returning({ id: products.id });
    if (!row) throw new Error("no product");
    if (sizes.length) {
      await testDb.db.insert(productVariants).values(
        sizes.map((size) => ({
          productId: row.id,
          volumeMl: size.ml,
          price: size.price,
          stockQuantity: size.stock ?? 0,
          trackStock: size.tracked ?? false,
        })),
      );
    }
  }

  it("lists every product with its sizes in stock, smallest first", async () => {
    const { listPerfumerProducts } = await import("./perfumer");
    await product(
      "Aqua",
      [
        { ml: 50, price: "1500.00" },
        { ml: 30, price: "990.50" },
        // Tracked and sold out: left out.
        { ml: 100, price: "2500.00", tracked: true, stock: 0 },
      ],
      { families: ["водяні"], notes: ["морські ноти"], rank: 3 },
    );
    await product("Archived", [{ ml: 30, price: "900.00" }], { active: false });
    await product("No sizes", []);

    const rows = await listPerfumerProducts(testDb.db);
    const byTitle = new Map(rows.map((row) => [row.title, row]));

    expect(byTitle.get("Aqua")).toMatchObject({
      gender: "women",
      active: true,
      fragranceFamilies: ["водяні"],
      notes: ["морські ноти"],
      popularRank: 3,
      sizes: [
        { ml: 30, price: "990.50" },
        { ml: 50, price: "1500.00" },
      ],
    });
    expect(byTitle.get("Archived")).toMatchObject({ active: false });
    expect(byTitle.get("No sizes")?.sizes).toEqual([]);
  });
});
