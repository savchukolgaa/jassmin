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
  "products",
  "sessions",
  "user_events",
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
    const { cartItems, carts, orders, products } = await import("./schema");
    const { db } = testDb;

    const [product] = await db.insert(products).values(sampleProduct).returning();
    const [cart] = await db.insert(carts).values({}).returning();
    const [item] = await db
      .insert(cartItems)
      .values({ cartId: cart?.id ?? 0, productId: product?.id ?? 0 })
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
    const { cartItems, carts, orderItems, orders, products } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const [product] = await db.insert(products).values(sampleProduct).returning();
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    const cartItem = { cartId: cart?.id ?? 0, productId: product?.id ?? 0 };
    const orderItem = {
      orderId: order?.id ?? 0,
      productId: product?.id,
      priceAtPurchase: "100.00",
    };

    // 23514 check_violation, 23505 unique_violation, 23502 not_null_violation
    expect(await pgErrorCode(db.insert(cartItems).values({ ...cartItem, quantity: 0 }))).toBe(
      "23514",
    );
    await db.insert(cartItems).values(cartItem);
    expect(await pgErrorCode(db.insert(cartItems).values(cartItem))).toBe("23505");

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
    const { cartItems, carts, orderItems, orders, products } = await import("./schema");
    const { db } = testDb;

    const [product] = await db.insert(products).values(sampleProduct).returning();
    const productId = product?.id ?? 0;
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    await db.insert(cartItems).values({ cartId: cart?.id ?? 0, productId });
    const [orderItem] = await db
      .insert(orderItems)
      .values({ orderId: order?.id ?? 0, productId, quantity: 2, priceAtPurchase: "100.00" })
      .returning();

    await db.delete(products).where(eq(products.id, productId));

    const [kept] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItem?.id ?? 0));
    expect(kept).toMatchObject({ productId: null, quantity: 2, priceAtPurchase: "100.00" });
    expect(await db.select().from(cartItems).where(eq(cartItems.productId, productId))).toEqual([]);
  });

  it("cascades deleting a cart or an order to its items", async () => {
    const { cartItems, carts, orderItems, orders, products } = await import("./schema");
    const { db } = testDb;

    const [product] = await db.insert(products).values(sampleProduct).returning();
    const [cart] = await db.insert(carts).values({}).returning();
    const [order] = await db.insert(orders).values(sampleOrder).returning();
    const cartId = cart?.id ?? 0;
    const orderId = order?.id ?? 0;
    await db.insert(cartItems).values({ cartId, productId: product?.id ?? 0 });
    await db
      .insert(orderItems)
      .values({ orderId, productId: product?.id, quantity: 1, priceAtPurchase: "100.00" });

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

  it("applies the analytics defaults", async () => {
    const { sessions, userEvents } = await import("./schema");
    const { db } = testDb;

    const [session] = await db.insert(sessions).values({ anonymousId: "anon-1" }).returning();
    const [event] = await db
      .insert(userEvents)
      .values({
        anonymousId: "anon-1",
        sessionId: session?.sessionId ?? "",
        eventType: "search",
        eventProperties: { query: "rose", filters: { gender: "women" } },
      })
      .returning();

    const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/;
    expect(session?.sessionId).toMatch(uuidV7);
    expect(session?.startedAt).toBeInstanceOf(Date);
    expect(session).toMatchObject({
      userId: null,
      endedAt: null,
      landingPage: null,
      trafficSource: null,
      deviceType: null,
    });
    expect(event?.eventId).toMatch(uuidV7);
    expect(event?.createdAt).toBeInstanceOf(Date);
    expect(event).toMatchObject({
      userId: null,
      productId: null,
      eventProperties: { query: "rose", filters: { gender: "women" } },
      source: null,
      medium: null,
      campaign: null,
      deviceType: null,
      referrer: null,
    });
  });

  it("enforces the analytics constraints", async () => {
    const { sessions, userEvents } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const [session] = await db.insert(sessions).values({ anonymousId: "anon-2" }).returning();
    const event = {
      anonymousId: "anon-2",
      sessionId: session?.sessionId ?? "",
      eventType: "page_view",
    } as const;
    await db.insert(userEvents).values(event);

    // 23514 check_violation, 23503 foreign_key_violation, 23502 not_null_violation
    expect(
      await pgErrorCode(db.execute(sql`update user_events set event_type = 'page_click'`)),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db
          .insert(userEvents)
          .values({ ...event, sessionId: "00000000-0000-7000-8000-000000000000" }),
      ),
    ).toBe("23503");
    expect(
      await pgErrorCode(
        db.execute(sql`update carts set session_id = '00000000-0000-7000-8000-000000000000'`),
      ),
    ).toBe("23503");
    for (const column of ["anonymous_id", "session_id", "event_type", "created_at"]) {
      expect(
        await pgErrorCode(db.execute(sql`update user_events set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
    for (const column of ["anonymous_id", "started_at"]) {
      expect(
        await pgErrorCode(db.execute(sql`update sessions set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
  });

  it("stores analytics timestamps with time zone and indexes the analytics queries", async () => {
    const columns = await testDb.db.execute<{ column: string; data_type: string }>(
      sql`select table_name || '.' || column_name as column, data_type
          from information_schema.columns
          where table_name in ('sessions', 'user_events') and data_type like 'timestamp%'
          order by 1`,
    );
    expect(columns.rows).toEqual([
      { column: "sessions.ended_at", data_type: "timestamp with time zone" },
      { column: "sessions.started_at", data_type: "timestamp with time zone" },
      { column: "user_events.created_at", data_type: "timestamp with time zone" },
    ]);

    const indexes = await testDb.db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where tablename in ('sessions', 'user_events') and indexname like '%_idx'
          order by indexname`,
    );
    expect(
      Object.fromEntries(
        indexes.rows.map((r) => [r.indexname, r.indexdef.replace(/^.*USING btree /, "")]),
      ),
    ).toEqual({
      sessions_anonymous_id_idx: "(anonymous_id)",
      sessions_user_id_idx: "(user_id)",
      user_events_anonymous_id_idx: "(anonymous_id)",
      user_events_event_type_created_at_idx: "(event_type, created_at)",
      user_events_session_id_idx: "(session_id)",
      user_events_user_id_created_at_idx: "(user_id, created_at)",
    });
  });

  it("cascades or unlinks analytics rows on delete", async () => {
    const { carts, products, sessions, userEvents, users } = await import("./schema");
    const { db } = testDb;

    const [user] = await db
      .insert(users)
      .values({ ...sampleUser, email: "visitor@example.com" })
      .returning();
    const [product] = await db.insert(products).values(sampleProduct).returning();
    const userId = user?.id ?? 0;
    const productId = product?.id ?? 0;
    const [kept] = await db.insert(sessions).values({ anonymousId: "anon-3", userId }).returning();
    const [dropped] = await db.insert(sessions).values({ anonymousId: "anon-3" }).returning();
    const keptId = kept?.sessionId ?? "";
    const droppedId = dropped?.sessionId ?? "";
    const [keptEvent] = await db
      .insert(userEvents)
      .values({
        anonymousId: "anon-3",
        userId,
        sessionId: keptId,
        eventType: "product_view",
        productId,
      })
      .returning();
    await db
      .insert(userEvents)
      .values({ anonymousId: "anon-3", sessionId: droppedId, eventType: "page_view" });
    const [cart] = await db.insert(carts).values({ sessionId: droppedId }).returning();

    await db.delete(sessions).where(eq(sessions.sessionId, droppedId));
    expect(await db.select().from(userEvents).where(eq(userEvents.sessionId, droppedId))).toEqual(
      [],
    );
    const [cartAfter] = await db
      .select()
      .from(carts)
      .where(eq(carts.id, cart?.id ?? 0));
    expect(cartAfter?.sessionId).toBeNull();

    await db.delete(products).where(eq(products.id, productId));
    await db.delete(users).where(eq(users.id, userId));
    const [sessionAfter] = await db.select().from(sessions).where(eq(sessions.sessionId, keptId));
    const [eventAfter] = await db
      .select()
      .from(userEvents)
      .where(eq(userEvents.eventId, keptEvent?.eventId ?? ""));
    expect(sessionAfter).toMatchObject({ userId: null, anonymousId: "anon-3" });
    expect(eventAfter).toMatchObject({ userId: null, productId: null, eventType: "product_view" });
  });

  it("rolls back to an empty database and migrates up again", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");

    expect(await rollbackLatest(testDb.db)).toBe("0002_analytics_schema");
    expect(await listTables()).toEqual([
      "cart_items",
      "carts",
      "order_items",
      "orders",
      "products",
      "users",
    ]);
    const cartFks = await testDb.db.execute<{ conname: string }>(
      sql`select conname from pg_constraint where conrelid = 'carts'::regclass and contype = 'f'`,
    );
    expect(cartFks.rows.map((r) => r.conname)).toEqual(["carts_user_id_users_id_fk"]);
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
