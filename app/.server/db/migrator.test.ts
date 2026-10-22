import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "./test-utils";

const sampleProduct = {
  title: "Test",
  brand: "Test",
  gender: "unisex",
  price: "100.00",
  volumeMl: 50,
} as const;

const sampleUser = { fullName: "Test User", email: "test@example.com", passwordHash: "hash" };

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("migrations", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    testDb = await createTestDatabase("jassmin_migrate_test");
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function listTables(): Promise<string[]> {
    const result = await testDb.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' order by table_name`,
    );
    return result.rows.map((r) => r.table_name);
  }

  async function listEnums(): Promise<Record<string, string[]>> {
    const result = await testDb.db.execute<{ name: string; labels: string[] }>(
      sql`select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' group by t.typname`,
    );
    return Object.fromEntries(result.rows.map((r) => [r.name, r.labels]));
  }

  it("migrates an empty database up", async () => {
    const { migrateLatest } = await import("./migrator");

    await migrateLatest(testDb.db);

    expect(await listTables()).toEqual(["products", "users"]);
    expect(await listEnums()).toEqual({
      gender_type: ["women", "men", "unisex"],
      order_status_type: [
        "pending",
        "paid",
        "shipped",
        "completed",
        "cancelled",
        "returned",
        "unclaimed",
      ],
      payment_status_type: ["unpaid", "paid", "refunded"],
      cart_status_type: ["active", "converted", "abandoned"],
    });

    const constraints = await testDb.db.execute<{ conname: string }>(
      sql`select conname from pg_constraint where conrelid in ('products'::regclass, 'users'::regclass)
          and contype in ('c', 'u') order by conname`,
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "products_pack_size_check",
      "products_public_id_unique",
      "products_stock_quantity_check",
      "users_email_unique",
    ]);

    const indexes = await testDb.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'products_gender_idx'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain("(gender)");
  });

  it("applies the column defaults", async () => {
    const { products, users } = await import("./schema");

    const [product] = await testDb.db.insert(products).values(sampleProduct).returning();
    const [user] = await testDb.db.insert(users).values(sampleUser).returning();

    expect(product?.stockQuantity).toBe(0);
    expect(product?.packSize).toBe(1);
    expect(product?.createdAt).toBeInstanceOf(Date);
    // UUID v7: the version nibble (13th hex digit) is 7.
    expect(product?.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    expect(user?.acquisitionChannel).toBe("direct");
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.lastLoginAt).toBeNull();
  });

  it("enforces the constraints", async () => {
    const { products, users } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    // 23514 check_violation, 23505 unique_violation, 23502 not_null_violation
    expect(
      await pgErrorCode(db.insert(products).values({ ...sampleProduct, stockQuantity: -1 })),
    ).toBe("23514");
    expect(await pgErrorCode(db.insert(products).values({ ...sampleProduct, packSize: 0 }))).toBe(
      "23514",
    );
    expect(await pgErrorCode(db.insert(users).values(sampleUser))).toBe("23505");

    const [existing] = await db.select({ publicId: products.publicId }).from(products).limit(1);
    expect(
      await pgErrorCode(
        db.insert(products).values({ ...sampleProduct, publicId: existing?.publicId }),
      ),
    ).toBe("23505");

    for (const column of ["stock_quantity", "pack_size", "created_at", "public_id"]) {
      expect(
        await pgErrorCode(db.execute(sql`update products set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
    for (const column of ["acquisition_channel", "created_at"]) {
      expect(
        await pgErrorCode(db.execute(sql`update users set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
  });

  it("rolls back to an empty database and migrates up again", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");

    expect(await rollbackLatest(testDb.db)).toBe("0000_core_schema");
    expect(await listTables()).toEqual([]);
    expect(await listEnums()).toEqual({});
    expect(await rollbackLatest(testDb.db)).toBeNull();

    await migrateLatest(testDb.db);
    expect(await listTables()).toEqual(["products", "users"]);
  });
});
