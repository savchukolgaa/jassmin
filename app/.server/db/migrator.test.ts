import { eq, sql } from "drizzle-orm";
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

const sampleOrder = {
  guestFullName: "Test Buyer",
  guestEmail: "buyer@example.com",
  guestPhone: "+380501234567",
  shippingAddress: "Kyiv, Nova Poshta branch 1",
  paymentMethod: "cod",
  subtotal: "100.00",
  totalAmount: "100.00",
} as const;

const ALL_TABLES = [
  "cart_items",
  "carts",
  "order_items",
  "orders",
  "product_variants",
  "products",
  "users",
];

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

  /** Inserts the sample product with one 50 ml variant. */
  async function insertProductWithVariant() {
    const { productVariants, products } = await import("./schema");
    const [product] = await testDb.db.insert(products).values(sampleProduct).returning();
    const [variant] = await testDb.db
      .insert(productVariants)
      .values({ productId: product?.id ?? 0, volumeMl: 50, price: "100.00", stockQuantity: 3 })
      .returning();
    return { productId: product?.id ?? 0, variantId: variant?.id ?? 0 };
  }

  it("migrates an empty database up", async () => {
    const { migrateLatest } = await import("./migrator");

    await migrateLatest(testDb.db);

    expect(await listTables()).toEqual(ALL_TABLES);
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

  it("applies the commerce defaults", async () => {
    const { cartItems, carts, orders } = await import("./schema");
    const { db } = testDb;

    const { productId, variantId } = await insertProductWithVariant();
    const [cart] = await db.insert(carts).values({}).returning();
    const [item] = await db
      .insert(cartItems)
      .values({ cartId: cart?.id ?? 0, productId, variantId })
      .returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();

    expect(cart?.status).toBe("active");
    expect(cart?.userId).toBeNull();
    expect(cart?.updatedAt).toBeInstanceOf(Date);
    expect(item?.quantity).toBe(1);
    expect(item?.addedAt).toBeInstanceOf(Date);
    expect(order).toMatchObject({
      userId: null,
      status: "pending",
      paymentStatus: "unpaid",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      currency: "UAH",
      paidAt: null,
      cancelledAt: null,
      refundedAt: null,
    });
    expect(order?.updatedAt).toBeInstanceOf(Date);
  });

  it("enforces the commerce constraints", async () => {
    const { cartItems, carts, orderItems, orders, productVariants } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const { productId, variantId } = await insertProductWithVariant();
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    const cartItem = { cartId: cart?.id ?? 0, productId, variantId };
    const orderItem = {
      orderId: order?.id ?? 0,
      productId,
      variantId,
      priceAtPurchase: "100.00",
    };

    // 23514 check_violation, 23505 unique_violation, 23502 not_null_violation
    expect(await pgErrorCode(db.insert(cartItems).values({ ...cartItem, quantity: 0 }))).toBe(
      "23514",
    );
    await db.insert(cartItems).values(cartItem);
    expect(await pgErrorCode(db.insert(cartItems).values(cartItem))).toBe("23505");

    // Another size of the same product is its own line.
    const [tenMl] = await db
      .insert(productVariants)
      .values({ productId, volumeMl: 10, price: "30.00" })
      .returning();
    await db.insert(cartItems).values({ ...cartItem, variantId: tenMl?.id ?? 0 });

    const variant = { productId, price: "10.00" };
    expect(await pgErrorCode(db.insert(productVariants).values({ ...variant, volumeMl: 50 }))).toBe(
      "23505",
    );
    for (const volumeMl of [0, 5, 20, 75, 150]) {
      expect(await pgErrorCode(db.insert(productVariants).values({ ...variant, volumeMl }))).toBe(
        "23514",
      );
    }
    expect(
      await pgErrorCode(
        db.insert(productVariants).values({ ...variant, volumeMl: 7, stockQuantity: -1 }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.insert(productVariants).values({ ...variant, volumeMl: 7, price: "-1" }),
      ),
    ).toBe("23514");

    expect(await pgErrorCode(db.insert(orderItems).values({ ...orderItem, quantity: 0 }))).toBe(
      "23514",
    );
    expect(
      await pgErrorCode(
        db.insert(orderItems).values({ ...orderItem, quantity: 1, priceAtPurchase: "-1.00" }),
      ),
    ).toBe("23514");

    expect(await pgErrorCode(db.execute(sql`update orders set payment_method = 'cash'`))).toBe(
      "23514",
    );
    for (const column of ["subtotal", "discount_amount", "shipping_amount", "total_amount"]) {
      expect(
        await pgErrorCode(db.execute(sql`update orders set ${sql.identifier(column)} = -1`)),
      ).toBe("23514");
    }
    for (const column of [
      "guest_full_name",
      "guest_email",
      "guest_phone",
      "shipping_address",
      "payment_method",
      "currency",
    ]) {
      expect(
        await pgErrorCode(db.execute(sql`update orders set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
  });

  it("indexes the guest contact fields", async () => {
    const indexes = await testDb.db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where indexname in ('orders_guest_email_idx', 'orders_guest_phone_idx')
          order by indexname`,
    );

    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "orders_guest_email_idx",
      "orders_guest_phone_idx",
    ]);
    expect(indexes.rows[0]?.indexdef).toContain("(guest_email)");
    expect(indexes.rows[1]?.indexdef).toContain("(guest_phone)");
  });

  it("keeps order items with product_id = NULL when their product is deleted", async () => {
    const { cartItems, carts, orderItems, orders, productVariants, products } = await import(
      "./schema"
    );
    const { db } = testDb;

    const { productId, variantId } = await insertProductWithVariant();
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    await db.insert(cartItems).values({ cartId: cart?.id ?? 0, productId, variantId });
    const [orderItem] = await db
      .insert(orderItems)
      .values({
        orderId: order?.id ?? 0,
        productId,
        variantId,
        volumeMl: 50,
        quantity: 2,
        priceAtPurchase: "100.00",
      })
      .returning();

    await db.delete(products).where(eq(products.id, productId));

    const [kept] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItem?.id ?? 0));
    expect(kept).toMatchObject({
      productId: null,
      variantId: null,
      volumeMl: 50,
      quantity: 2,
      priceAtPurchase: "100.00",
    });
    expect(await db.select().from(cartItems).where(eq(cartItems.productId, productId))).toEqual([]);
    expect(
      await db.select().from(productVariants).where(eq(productVariants.productId, productId)),
    ).toEqual([]);
  });

  it("cascades deleting a cart or an order to its items", async () => {
    const { cartItems, carts, orderItems, orders } = await import("./schema");
    const { db } = testDb;

    const { productId, variantId } = await insertProductWithVariant();
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    const cartId = cart?.id ?? 0;
    const orderId = order?.id ?? 0;
    await db.insert(cartItems).values({ cartId, productId, variantId });
    await db
      .insert(orderItems)
      .values({ orderId, productId, variantId, quantity: 1, priceAtPurchase: "100.00" });

    await db.delete(carts).where(eq(carts.id, cartId));
    await db.delete(orders).where(eq(orders.id, orderId));

    expect(await db.select().from(cartItems).where(eq(cartItems.cartId, cartId))).toEqual([]);
    expect(await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))).toEqual([]);
  });

  it("refuses to delete a user who has carts or orders", async () => {
    const { carts, orders, users } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const [withCart] = await db
      .insert(users)
      .values({ ...sampleUser, email: "cart@example.com" })
      .returning();
    const [withOrder] = await db
      .insert(users)
      .values({ ...sampleUser, email: "order@example.com" })
      .returning();
    const [cart] = await db.insert(carts).values({ userId: withCart?.id }).returning();
    const [order] = await db
      .insert(orders)
      .values({ ...sampleOrder, userId: withOrder?.id })
      .returning();

    // 23001 restrict_violation (ON DELETE RESTRICT)
    for (const user of [withCart, withOrder]) {
      expect(await pgErrorCode(db.delete(users).where(eq(users.id, user?.id ?? 0)))).toBe("23001");
    }

    const [cartAfter] = await db
      .select()
      .from(carts)
      .where(eq(carts.id, cart?.id ?? 0));
    const [orderAfter] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, order?.id ?? 0));
    expect(cartAfter?.userId).toBe(withCart?.id);
    expect(orderAfter?.userId).toBe(withOrder?.id);
  });

  it("refreshes updated_at on query-builder updates", async () => {
    const { carts, orders } = await import("./schema");
    const { db } = testDb;
    const past = new Date("2020-01-01T00:00:00Z");

    const [cart] = await db.insert(carts).values({ updatedAt: past }).returning();
    const [order] = await db
      .insert(orders)
      .values({ ...sampleOrder, updatedAt: past })
      .returning();

    const [updatedCart] = await db
      .update(carts)
      .set({ status: "abandoned" })
      .where(eq(carts.id, cart?.id ?? 0))
      .returning();
    const [updatedOrder] = await db
      .update(orders)
      .set({ status: "paid" })
      .where(eq(orders.id, order?.id ?? 0))
      .returning();

    expect(updatedCart?.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    expect(updatedOrder?.updatedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it("backfills one variant per existing product and links its cart and order lines", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { db } = testDb;

    expect(await rollbackLatest(db)).toBe("0002_product_variants");
    expect(await listTables()).not.toContain("product_variants");

    // Rows as they looked before #26, written with raw SQL because the TS schema has moved on.
    const legacy = await db.execute<{ id: number }>(
      sql`insert into products (title, brand, gender, price, volume_ml, stock_quantity)
          values ('Legacy 30', 'Old', 'women', '1450.00', 30, 4),
                 ('Legacy 75', 'Old', 'men', '2000.00', 75, 1)
          returning id`,
    );
    const [allowed, odd] = legacy.rows.map((r) => r.id);
    const cart = await db.execute<{ id: number }>(
      sql`insert into carts default values returning id`,
    );
    const order = await db.execute<{ id: number }>(
      sql`insert into orders (guest_full_name, guest_email, guest_phone, shipping_address,
            payment_method, subtotal, total_amount)
          values ('B', 'b@example.com', '+380', 'Kyiv', 'cod', '1450.00', '1450.00') returning id`,
    );
    const cartId = cart.rows[0]?.id;
    const orderId = order.rows[0]?.id;
    await db.execute(
      sql`insert into cart_items (cart_id, product_id) values (${cartId}, ${allowed}), (${cartId}, ${odd})`,
    );
    await db.execute(
      sql`insert into order_items (order_id, product_id, quantity, price_at_purchase)
          values (${orderId}, ${allowed}, 1, '1450.00'), (${orderId}, ${odd}, 1, '2000.00')`,
    );

    await migrateLatest(db);

    const variants = await db.execute<{
      id: number;
      product_id: number;
      volume_ml: number;
      price: string;
      stock_quantity: number;
    }>(
      sql`select id, product_id, volume_ml, price, stock_quantity from product_variants
          where product_id in (${allowed}, ${odd})`,
    );
    expect(variants.rows).toEqual([
      expect.objectContaining({
        product_id: allowed,
        volume_ml: 30,
        price: "1450.00",
        stock_quantity: 4,
      }),
    ]);
    const variantId = variants.rows[0]?.id;

    // Legacy columns are kept for every product, including the one without a variant.
    const products = await db.execute<{ volume_ml: number }>(
      sql`select volume_ml from products where id in (${allowed}, ${odd})
          order by id`,
    );
    expect(products.rows.map((r) => r.volume_ml)).toEqual([30, 75]);

    const cartLines = await db.execute<{ product_id: number; variant_id: number }>(
      sql`select product_id, variant_id from cart_items where cart_id = ${cartId}`,
    );
    expect(cartLines.rows).toEqual([{ product_id: allowed, variant_id: variantId }]);
    const orderLines = await db.execute<{
      product_id: number;
      variant_id: number | null;
      volume_ml: number | null;
    }>(
      sql`select product_id, variant_id, volume_ml from order_items where order_id = ${orderId}
          order by id`,
    );
    expect(orderLines.rows).toEqual([
      { product_id: allowed, variant_id: variantId, volume_ml: 30 },
      { product_id: odd, variant_id: null, volume_ml: null },
    ]);
  });

  it("rolls back to an empty database and migrates up again", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");

    expect(await rollbackLatest(testDb.db)).toBe("0002_product_variants");
    expect(await listTables()).toEqual([
      "cart_items",
      "carts",
      "order_items",
      "orders",
      "products",
      "users",
    ]);
    expect(await rollbackLatest(testDb.db)).toBe("0001_commerce_schema");
    expect(await listTables()).toEqual(["products", "users"]);
    expect(await rollbackLatest(testDb.db)).toBe("0000_core_schema");
    expect(await listTables()).toEqual([]);
    expect(await listEnums()).toEqual({});
    expect(await rollbackLatest(testDb.db)).toBeNull();

    await migrateLatest(testDb.db);
    expect(await listTables()).toEqual(ALL_TABLES);
  });
});
