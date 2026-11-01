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
  "cms_outbox",
  "discounts",
  "order_emails",
  "order_items",
  "orders",
  "payments",
  "product_slug_history",
  "product_variants",
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
      user_role: ["customer", "admin"],
    });

    const constraints = await testDb.db.execute<{ conname: string }>(
      sql`select conname from pg_constraint where conrelid in ('products'::regclass, 'users'::regclass)
          and contype in ('c', 'u') order by conname`,
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "products_fragrance_family_primary_check",
      "products_pack_size_check",
      "products_popular_rank_check",
      "products_public_id_unique",
      "products_slug_unique",
      "products_stock_quantity_check",
      "users_email_unique",
    ]);

    const indexes = await testDb.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'products_gender_idx'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain("(gender)");
    const familyIndex = await testDb.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'products_fragrance_families_idx'`,
    );
    expect(familyIndex.rows[0]?.indexdef).toContain("USING gin (fragrance_families)");
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
    expect(user?.role).toBe("customer");
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.lastLoginAt).toBeNull();
  });

  it("enforces the constraints", async () => {
    const { products, users } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    // 23514 check_violation, 23505 unique_violation, 23502 not_null_violation,
    // 22P02 invalid_text_representation (not an enum value)
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
    expect(await pgErrorCode(db.execute(sql`update users set role = 'owner'`))).toBe("22P02");
    for (const column of ["acquisition_channel", "role", "created_at"]) {
      expect(
        await pgErrorCode(db.execute(sql`update users set ${sql.identifier(column)} = null`)),
      ).toBe("23502");
    }
  });

  it("enforces the discount constraints", async () => {
    const { discounts } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;
    const rule = { kind: "percent" as const, value: "10" };

    await db.insert(discounts).values({ ...rule, slug: "case-test", code: "CASE10" });
    // 23514 check_violation, 23505 unique_violation
    expect(
      await pgErrorCode(db.insert(discounts).values({ ...rule, slug: "case-2", code: "case10" })),
    ).toBe("23505");
    expect(await pgErrorCode(db.insert(discounts).values({ ...rule, slug: "case-test" }))).toBe(
      "23505",
    );
    // Automatic rules have no code, and any number of them may exist.
    await db.insert(discounts).values([
      { ...rule, slug: "auto-1" },
      { ...rule, slug: "auto-2" },
    ]);

    for (const bad of [
      { kind: "percent" as const, value: "0" },
      { kind: "percent" as const, value: "100.01" },
      { kind: "fixed_amount" as const, value: "-1" },
      { kind: "fixed_price_set" as const, value: "499", minQuantity: 1 },
      { ...rule, minQuantity: 0 },
      { ...rule, maxSets: 0 },
      { ...rule, startsAt: new Date("2026-02-01"), endsAt: new Date("2026-01-01") },
      { ...rule, maxRedemptions: 1, redemptionCount: 2 },
      { ...rule, redemptionCount: -1 },
    ]) {
      expect(await pgErrorCode(db.insert(discounts).values({ ...bad, slug: "bad" }))).toBe("23514");
    }
    expect(
      await pgErrorCode(
        db.insert(discounts).values({ slug: "bad", kind: "free_lunch" as "percent", value: "1" }),
      ),
    ).toBe("23514");
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
    for (const volumeMl of [0, 7, 20, 75, 150]) {
      expect(await pgErrorCode(db.insert(productVariants).values({ ...variant, volumeMl }))).toBe(
        "23514",
      );
    }
    expect(
      await pgErrorCode(
        db.insert(productVariants).values({ ...variant, volumeMl: 5, stockQuantity: -1 }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.insert(productVariants).values({ ...variant, volumeMl: 5, price: "-1" }),
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

  it("allows one active cart per user and per guest session", async () => {
    const { carts, sessions, users } = await import("./schema");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const [user] = await db
      .insert(users)
      .values({ ...sampleUser, email: "one-cart@example.com" })
      .returning();
    const [session] = await db.insert(sessions).values({ anonymousId: "anon-cart" }).returning();
    const userId = user?.id ?? 0;
    const sessionId = session?.sessionId ?? "";

    await db.insert(carts).values({ userId, sessionId });
    expect(await pgErrorCode(db.insert(carts).values({ userId }))).toBe("23505");
    // Finished carts don't count.
    await db.insert(carts).values({ userId, status: "converted" });

    await db.insert(carts).values({ sessionId });
    expect(await pgErrorCode(db.insert(carts).values({ sessionId }))).toBe("23505");
    await db.insert(carts).values({ sessionId, status: "abandoned" });

    const indexes = await db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where indexname like 'carts_active_%'
          order by indexname`,
    );
    expect(
      indexes.rows.map((r) => [r.indexname, r.indexdef.replace(/^.*USING btree /, "")]),
    ).toEqual([
      [
        "carts_active_guest_session_id_unique",
        "(session_id) WHERE ((status = 'active'::cart_status_type) AND (user_id IS NULL))",
      ],
      [
        "carts_active_user_id_unique",
        "(user_id) WHERE ((status = 'active'::cart_status_type) AND (user_id IS NOT NULL))",
      ],
    ]);
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
    const { carts, orders, products } = await import("./schema");
    const { db } = testDb;
    const past = new Date("2020-01-01T00:00:00Z");

    const [product] = await db
      .insert(products)
      .values({ ...sampleProduct, updatedAt: past })
      .returning();
    const [updatedProduct] = await db
      .update(products)
      .set({ title: "Renamed" })
      .where(eq(products.id, product?.id ?? 0))
      .returning();
    expect(updatedProduct?.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    await db.delete(products).where(eq(products.id, product?.id ?? 0));

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
        // One cart, so the one-active-cart-per-session index can't fire first.
        db.execute(
          sql`update carts set session_id = '00000000-0000-7000-8000-000000000000'
              where id = (select min(id) from carts)`,
        ),
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

  it("backfills abandoned_at from updated_at for carts abandoned before 0006", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { db } = testDb;

    // 0007 to 0017 sit on top of 0006; migrateLatest below reapplies them.
    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(db)).toBe("0016_product_slug_history");
    expect(await rollbackLatest(db)).toBe("0015_volume_5ml");
    expect(await rollbackLatest(db)).toBe("0014_product_popular_rank");
    expect(await rollbackLatest(db)).toBe("0013_product_families_notes_code");
    expect(await rollbackLatest(db)).toBe("0012_cms_catalog_and_orders");
    expect(await rollbackLatest(db)).toBe("0011_discounts");
    expect(await rollbackLatest(db)).toBe("0010_payments");
    expect(await rollbackLatest(db)).toBe("0009_order_emails");
    expect(await rollbackLatest(db)).toBe("0008_traffic_attribution");
    expect(await rollbackLatest(db)).toBe("0007_order_checkout_fields");
    expect(await rollbackLatest(db)).toBe("0006_cart_abandoned_at");
    const legacy = await db.execute<{ id: number }>(
      sql`insert into carts (status, updated_at)
          values ('abandoned', '2026-01-02T03:04:05Z'), ('active', '2026-01-02T03:04:05Z')
          returning id`,
    );
    const [abandonedId, activeId] = legacy.rows.map((r) => r.id);

    await migrateLatest(db);

    const rows = await db.execute<{ id: number; abandoned_at: string | null }>(
      sql`select id, abandoned_at from carts where id in (${abandonedId}, ${activeId}) order by id`,
    );
    expect(
      rows.rows.map((r) => [r.id, r.abandoned_at === null ? null : new Date(r.abandoned_at)]),
    ).toEqual([
      [abandonedId, new Date("2026-01-02T03:04:05Z")],
      [activeId, null],
    ]);
  });

  it("backfills one variant per existing product and links its cart and order lines", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { db } = testDb;

    // 0004 to 0017 sit on top of 0003; migrateLatest below reapplies them.
    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(db)).toBe("0016_product_slug_history");
    expect(await rollbackLatest(db)).toBe("0015_volume_5ml");
    expect(await rollbackLatest(db)).toBe("0014_product_popular_rank");
    expect(await rollbackLatest(db)).toBe("0013_product_families_notes_code");
    expect(await rollbackLatest(db)).toBe("0012_cms_catalog_and_orders");
    expect(await rollbackLatest(db)).toBe("0011_discounts");
    expect(await rollbackLatest(db)).toBe("0010_payments");
    expect(await rollbackLatest(db)).toBe("0009_order_emails");
    expect(await rollbackLatest(db)).toBe("0008_traffic_attribution");
    expect(await rollbackLatest(db)).toBe("0007_order_checkout_fields");
    expect(await rollbackLatest(db)).toBe("0006_cart_abandoned_at");
    expect(await rollbackLatest(db)).toBe("0005_cart_active_unique");
    expect(await rollbackLatest(db)).toBe("0004_user_role");
    expect(await rollbackLatest(db)).toBe("0003_product_variants");
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

  it("adds an optional, positive popular_rank and rolls it back", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    const inserted = await db.execute<{ id: number; popular_rank: number | null }>(
      sql`insert into products (title, brand, gender, price, volume_ml)
          values ('Ranked', 'Test', 'women', '100.00', 50) returning id, popular_rank`,
    );
    const [row] = inserted.rows;
    expect(row?.popular_rank).toBeNull();
    await db.execute(sql`update products set popular_rank = 1 where id = ${row?.id}`);
    // 23514 check_violation: positions start at 1.
    expect(
      await pgErrorCode(
        db.execute(sql`update products set popular_rank = 0 where id = ${row?.id}`),
      ),
    ).toBe("23514");

    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(db)).toBe("0016_product_slug_history");
    expect(await rollbackLatest(db)).toBe("0015_volume_5ml");
    expect(await rollbackLatest(db)).toBe("0014_product_popular_rank");
    const columns = await db.execute(
      sql`select 1 from information_schema.columns where table_name = 'products'
          and column_name = 'popular_rank'`,
    );
    expect(columns.rows).toEqual([]);
    await migrateLatest(db);
    await db.execute(sql`delete from products where id = ${row?.id}`);
  });

  it("backfills fragrance_families from fragrance_family and keeps the primary in sync", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(db)).toBe("0016_product_slug_history");

    expect(await rollbackLatest(db)).toBe("0015_volume_5ml");
    expect(await rollbackLatest(db)).toBe("0014_product_popular_rank");
    expect(await rollbackLatest(db)).toBe("0013_product_families_notes_code");
    // Products as they looked before #65, with one family or none.
    const legacy = await db.execute<{ id: number }>(
      sql`insert into products (title, brand, gender, price, volume_ml, fragrance_family)
          values ('Woody', 'Old', 'men', '100.00', 50, 'деревні'),
                 ('None', 'Old', 'women', '100.00', 50, null)
          returning id`,
    );
    const [woody, none] = legacy.rows.map((r) => r.id);

    await migrateLatest(db);

    const rows = await db.execute<{
      id: number;
      fragrance_family: string | null;
      fragrance_families: string[];
      notes: string[];
      store_code: string | null;
    }>(
      sql`select id, fragrance_family, fragrance_families, notes, store_code from products
          where id in (${woody}, ${none}) order by id`,
    );
    expect(rows.rows).toEqual([
      {
        id: woody,
        fragrance_family: "деревні",
        fragrance_families: ["деревні"],
        notes: [],
        store_code: null,
      },
      { id: none, fragrance_family: null, fragrance_families: [], notes: [], store_code: null },
    ]);

    // 23514 check_violation: fragrance_family must be the first of fragrance_families.
    expect(
      await pgErrorCode(
        db.execute(
          sql`update products set fragrance_families = '{квіткові,деревні}' where id = ${woody}`,
        ),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.execute(sql`update products set fragrance_family = 'деревні' where id = ${none}`),
      ),
    ).toBe("23514");
    await db.execute(
      sql`update products set fragrance_families = '{квіткові,деревні}',
            fragrance_family = 'квіткові' where id = ${woody}`,
    );
  });

  it("replaces 7 ml with 5 ml, keeping order lines and queuing the products for Strapi", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { pgErrorCode } = await import("./test-utils");
    const { db } = testDb;

    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(db)).toBe("0016_product_slug_history");

    expect(await rollbackLatest(db)).toBe("0015_volume_5ml");
    // Before #66: a product sold in 7 and 30 ml (legacy columns on 7 ml) and one only in 7 ml.
    const legacy = await db.execute<{ id: number }>(
      sql`insert into products (title, brand, gender, price, volume_ml, stock_quantity)
          values ('Mini', 'Old', 'women', '500.00', 7, 2), ('Only mini', 'Old', 'men', '400.00', 7, 1)
          returning id`,
    );
    const [mini, onlyMini] = legacy.rows.map((r) => r.id);
    const sizes = await db.execute<{ id: number }>(
      sql`insert into product_variants (product_id, volume_ml, price, stock_quantity)
          values (${mini}, 7, '500.00', 2), (${mini}, 30, '1500.00', 4), (${onlyMini}, 7, '400.00', 1)
          returning id`,
    );
    const [miniSeven] = sizes.rows.map((r) => r.id);
    const cart = await db.execute<{ id: number }>(
      sql`insert into carts default values returning id`,
    );
    const order = await db.execute<{ id: number }>(
      sql`insert into orders (guest_full_name, guest_email, guest_phone, shipping_address,
            payment_method, subtotal, total_amount)
          values ('B', 'b@example.com', '+380', 'Kyiv', 'cod', '500.00', '500.00') returning id`,
    );
    const cartId = cart.rows[0]?.id;
    const orderId = order.rows[0]?.id;
    await db.execute(
      sql`insert into cart_items (cart_id, product_id, variant_id) values (${cartId}, ${mini}, ${miniSeven})`,
    );
    await db.execute(
      sql`insert into order_items (order_id, product_id, variant_id, volume_ml, quantity, price_at_purchase)
          values (${orderId}, ${mini}, ${miniSeven}, 7, 1, '500.00')`,
    );

    await migrateLatest(db);

    const variants = await db.execute<{ product_id: number; volume_ml: number }>(
      sql`select product_id, volume_ml from product_variants where product_id in (${mini}, ${onlyMini})`,
    );
    expect(variants.rows).toEqual([{ product_id: mini, volume_ml: 30 }]);
    const products = await db.execute<{ price: string; volume_ml: number; stock_quantity: number }>(
      sql`select price, volume_ml, stock_quantity from products where id in (${mini}, ${onlyMini})
          order by id`,
    );
    // The only-7-ml product has no size left, so its legacy columns stay as they were.
    expect(products.rows).toEqual([
      { price: "1500.00", volume_ml: 30, stock_quantity: 4 },
      { price: "400.00", volume_ml: 7, stock_quantity: 1 },
    ]);
    const cartLines = await db.execute(sql`select 1 from cart_items where cart_id = ${cartId}`);
    expect(cartLines.rows).toEqual([]);
    const orderLines = await db.execute<{ variant_id: number | null; volume_ml: number }>(
      sql`select variant_id, volume_ml from order_items where order_id = ${orderId}`,
    );
    expect(orderLines.rows).toEqual([{ variant_id: null, volume_ml: 7 }]);
    const queued = await db.execute<{ entity_id: number; synced_at: string | null }>(
      sql`select entity_id, synced_at from cms_outbox
          where entity = 'product' and entity_id in (${mini}, ${onlyMini}) order by entity_id`,
    );
    expect(queued.rows).toEqual([
      { entity_id: mini, synced_at: null },
      { entity_id: onlyMini, synced_at: null },
    ]);

    // 23514 check_violation: 7 ml is refused from now on, 5 ml is a size.
    const size = { productId: mini ?? 0, price: "100.00" };
    const { productVariants } = await import("./schema");
    expect(await pgErrorCode(db.insert(productVariants).values({ ...size, volumeMl: 7 }))).toBe(
      "23514",
    );
    await db.insert(productVariants).values({ ...size, volumeMl: 5 });
  });

  it("backfills products.updated_at from created_at and rolls it back", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");
    const { db } = testDb;

    expect(await rollbackLatest(db)).toBe("0017_product_updated_at");
    const columns = await db.execute(
      sql`select 1 from information_schema.columns where table_name = 'products'
          and column_name = 'updated_at'`,
    );
    expect(columns.rows).toEqual([]);
    const inserted = await db.execute<{ id: number }>(
      sql`insert into products (title, brand, gender, price, volume_ml, created_at)
          values ('Before 0017', 'Test', 'women', '100.00', 50, '2026-01-02T03:04:05Z')
          returning id`,
    );
    const id = inserted.rows[0]?.id;

    await migrateLatest(db);

    const rows = await db.execute<{ updated_at: string }>(
      sql`select updated_at from products where id = ${id}`,
    );
    expect(new Date(rows.rows[0]?.updated_at ?? "")).toEqual(new Date("2026-01-02T03:04:05Z"));
    await db.execute(sql`delete from products where id = ${id}`);
  });

  it("rolls back to an empty database and migrates up again", async () => {
    const { migrateLatest, rollbackLatest } = await import("./migrator");

    expect(await rollbackLatest(testDb.db)).toBe("0017_product_updated_at");
    expect(await rollbackLatest(testDb.db)).toBe("0016_product_slug_history");

    expect(await rollbackLatest(testDb.db)).toBe("0015_volume_5ml");
    expect(await rollbackLatest(testDb.db)).toBe("0014_product_popular_rank");
    expect(await rollbackLatest(testDb.db)).toBe("0013_product_families_notes_code");
    const familyColumns = await testDb.db.execute(
      sql`select 1 from information_schema.columns where table_name = 'products'
          and column_name in ('fragrance_families', 'notes', 'store_code')`,
    );
    expect(familyColumns.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0012_cms_catalog_and_orders");
    const tablesBefore0012 = ALL_TABLES.filter(
      (t) => t !== "cms_outbox" && t !== "product_slug_history",
    );
    expect(await listTables()).toEqual(tablesBefore0012);
    const syncColumns = await testDb.db.execute(
      sql`select 1 from information_schema.columns
          where (table_name = 'products' and column_name in ('slug', 'active'))
             or (table_name = 'orders' and column_name in ('shipped_at', 'completed_at'))`,
    );
    expect(syncColumns.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0011_discounts");
    expect(await listTables()).toEqual(tablesBefore0012.filter((t) => t !== "discounts"));
    const discountColumns = await testDb.db.execute(
      sql`select 1 from information_schema.columns where column_name = 'discount_id'`,
    );
    expect(discountColumns.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0010_payments");
    expect(await listTables()).toEqual(
      tablesBefore0012.filter((t) => t !== "discounts" && t !== "payments"),
    );
    expect(await rollbackLatest(testDb.db)).toBe("0009_order_emails");
    expect(await listTables()).toEqual(
      tablesBefore0012.filter((t) => t !== "discounts" && t !== "payments" && t !== "order_emails"),
    );
    expect(await rollbackLatest(testDb.db)).toBe("0008_traffic_attribution");
    const attributionColumns = await testDb.db.execute(
      sql`select 1 from information_schema.columns
          where column_name in ('traffic_medium', 'traffic_campaign', 'first_touch_source',
            'first_touch_medium', 'first_touch_campaign')`,
    );
    expect(attributionColumns.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0007_order_checkout_fields");
    const orderCheckoutColumns = await testDb.db.execute(
      sql`select 1 from information_schema.columns
          where table_name = 'orders' and column_name in ('cart_id', 'free_shipping')`,
    );
    expect(orderCheckoutColumns.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0006_cart_abandoned_at");
    const abandonedAtColumn = await testDb.db.execute(
      sql`select 1 from information_schema.columns where table_name = 'carts' and column_name = 'abandoned_at'`,
    );
    expect(abandonedAtColumn.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0005_cart_active_unique");
    const activeCartIndexes = await testDb.db.execute(
      sql`select 1 from pg_indexes where indexname like 'carts_active_%'`,
    );
    expect(activeCartIndexes.rows).toEqual([]);
    expect(await rollbackLatest(testDb.db)).toBe("0004_user_role");
    const roleColumn = await testDb.db.execute(
      sql`select 1 from information_schema.columns where table_name = 'users' and column_name = 'role'`,
    );
    expect(roleColumn.rows).toEqual([]);
    expect(await listEnums()).not.toHaveProperty("user_role");
    expect(await rollbackLatest(testDb.db)).toBe("0003_product_variants");
    expect(await listTables()).toEqual(
      tablesBefore0012.filter(
        (t) =>
          t !== "product_variants" && t !== "order_emails" && t !== "payments" && t !== "discounts",
      ),
    );
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
