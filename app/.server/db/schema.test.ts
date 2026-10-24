import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AnalyticsSession, UserEvent } from "~/lib/analytics";
import type { Cart, CartItem, Order, OrderItem, ProductVariant } from "~/lib/commerce";
import { CART_STATUSES, GENDERS, ORDER_STATUSES, PAYMENT_STATUSES, USER_ROLES } from "~/lib/enums";
import {
  cartItems,
  cartStatusType,
  carts,
  genderType,
  orderItems,
  orderStatusType,
  orders,
  paymentStatusType,
  products,
  productVariants,
  sessions,
  userEvents,
  userRoleType,
  users,
} from "./schema";

/** TS column key (snake_case is applied later, by `casing`) → [SQL type, not null, has default]. */
function describeColumns(table: Parameters<typeof getTableConfig>[0]) {
  return Object.fromEntries(
    getTableConfig(table).columns.map((column) => [
      column.name,
      [column.getSQLType(), column.notNull, column.hasDefault],
    ]),
  );
}

/** TS column key → [referenced table, on delete action], for each foreign key. */
function describeForeignKeys(table: Parameters<typeof getTableConfig>[0]) {
  return Object.fromEntries(
    getTableConfig(table).foreignKeys.map((fk) => {
      const { columns, foreignTable } = fk.reference();
      return [columns.map((c) => c.name).join(","), [getTableName(foreignTable), fk.onDelete]];
    }),
  );
}

/** Names of the table's checks, unique constraints and indexes, each sorted. */
function describeConstraints(table: Parameters<typeof getTableConfig>[0]) {
  const { checks, uniqueConstraints, indexes } = getTableConfig(table);
  return {
    checks: checks.map((c) => c.name).sort(),
    uniques: uniqueConstraints.map((u) => u.getName()).sort(),
    indexes: indexes.map((i) => i.config.name).sort(),
  };
}

describe("enums", () => {
  it("match the shared TS values from ~/lib/enums", () => {
    expect(genderType.enumName).toBe("gender_type");
    expect(genderType.enumValues).toEqual([...GENDERS]);
    expect(orderStatusType.enumName).toBe("order_status_type");
    expect(orderStatusType.enumValues).toEqual([...ORDER_STATUSES]);
    expect(paymentStatusType.enumName).toBe("payment_status_type");
    expect(paymentStatusType.enumValues).toEqual([...PAYMENT_STATUSES]);
    expect(cartStatusType.enumName).toBe("cart_status_type");
    expect(cartStatusType.enumValues).toEqual([...CART_STATUSES]);
    expect(userRoleType.enumName).toBe("user_role");
    expect(userRoleType.enumValues).toEqual([...USER_ROLES]);
  });
});

describe("users", () => {
  it("has the specified columns", () => {
    expect(describeColumns(users)).toEqual({
      id: ["serial", true, true],
      fullName: ["varchar(255)", true, false],
      email: ["varchar(255)", true, false],
      passwordHash: ["varchar(255)", true, false],
      phone: ["varchar(50)", false, false],
      acquisitionChannel: ["text", true, true],
      role: ["user_role", true, true],
      lastLoginAt: ["timestamp with time zone", false, false],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("makes email unique and defaults acquisition_channel to 'direct' and role to 'customer'", () => {
    const { columns } = getTableConfig(users);

    expect(columns.find((c) => c.name === "email")?.isUnique).toBe(true);
    expect(columns.find((c) => c.name === "acquisitionChannel")?.default).toBe("direct");
    expect(columns.find((c) => c.name === "role")?.default).toBe("customer");
  });
});

describe("products", () => {
  it("has the specified columns", () => {
    expect(describeColumns(products)).toEqual({
      id: ["serial", true, true],
      publicId: ["uuid", true, true],
      title: ["varchar(255)", true, false],
      brand: ["varchar(255)", true, false],
      gender: ["gender_type", true, false],
      fragranceFamily: ["text", false, false],
      description: ["text", false, false],
      price: ["numeric(10, 2)", true, false],
      volumeMl: ["integer", true, false],
      packSize: ["integer", true, true],
      stockQuantity: ["integer", true, true],
      imageUrl: ["text", false, false],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("has the checks, the unique public_id and the gender index", () => {
    const { checks, columns, indexes } = getTableConfig(products);

    expect(checks.map((c) => c.name).sort()).toEqual([
      "products_pack_size_check",
      "products_stock_quantity_check",
    ]);
    expect(columns.find((c) => c.name === "publicId")?.isUnique).toBe(true);
    expect(indexes.map((i) => i.config.name)).toEqual(["products_gender_idx"]);
  });
});

describe("product_variants", () => {
  it("has the specified columns", () => {
    expect(describeColumns(productVariants)).toEqual({
      id: ["serial", true, true],
      publicId: ["uuid", true, true],
      productId: ["integer", true, false],
      volumeMl: ["integer", true, false],
      price: ["numeric(10, 2)", true, false],
      stockQuantity: ["integer", true, true],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("cascades product deletes and has the checks, uniques and product index", () => {
    const { columns } = getTableConfig(productVariants);

    expect(describeForeignKeys(productVariants)).toEqual({ productId: ["products", "cascade"] });
    expect(describeConstraints(productVariants)).toEqual({
      checks: [
        "product_variants_price_check",
        "product_variants_stock_quantity_check",
        "product_variants_volume_ml_check",
      ],
      uniques: ["product_variants_product_id_volume_ml_unique"],
      indexes: ["product_variants_product_id_idx"],
    });
    expect(columns.find((c) => c.name === "publicId")?.isUnique).toBe(true);
  });
});

describe("carts", () => {
  it("has the specified columns", () => {
    expect(describeColumns(carts)).toEqual({
      id: ["serial", true, true],
      userId: ["integer", false, false],
      sessionId: ["uuid", false, false],
      status: ["cart_status_type", true, true],
      createdAt: ["timestamp with time zone", true, true],
      updatedAt: ["timestamp with time zone", true, true],
      abandonedAt: ["timestamp with time zone", false, false],
    });
  });

  it("links the analytics session, restricts deleting a user and has the lookup indexes", () => {
    expect(describeForeignKeys(carts)).toEqual({
      sessionId: ["sessions", "set null"],
      userId: ["users", "restrict"],
    });
    expect(describeConstraints(carts)).toEqual({
      checks: [],
      uniques: [],
      indexes: [
        "carts_active_guest_session_id_unique",
        "carts_active_user_id_unique",
        "carts_session_id_idx",
        "carts_status_updated_at_idx",
        "carts_user_id_idx",
      ],
    });
  });

  it("defaults status to 'active' and refreshes updated_at on update", () => {
    const { columns } = getTableConfig(carts);

    expect(columns.find((c) => c.name === "status")?.default).toBe("active");
    expect(columns.find((c) => c.name === "updatedAt")?.onUpdateFn?.()).toBeInstanceOf(Date);
  });
});

describe("cart_items", () => {
  it("has the specified columns", () => {
    expect(describeColumns(cartItems)).toEqual({
      id: ["serial", true, true],
      cartId: ["integer", true, false],
      productId: ["integer", true, false],
      variantId: ["integer", true, false],
      quantity: ["integer", true, true],
      addedAt: ["timestamp with time zone", true, true],
    });
  });

  it("cascades deletes and has the quantity check and the unique (cart_id, variant_id)", () => {
    expect(describeForeignKeys(cartItems)).toEqual({
      cartId: ["carts", "cascade"],
      productId: ["products", "cascade"],
      variantId: ["product_variants", "cascade"],
    });
    expect(describeConstraints(cartItems)).toEqual({
      checks: ["cart_items_quantity_check"],
      uniques: ["cart_items_cart_id_variant_id_unique"],
      indexes: [],
    });
  });
});

describe("orders", () => {
  it("has the specified columns", () => {
    expect(describeColumns(orders)).toEqual({
      id: ["serial", true, true],
      userId: ["integer", false, false],
      guestFullName: ["varchar(255)", true, false],
      guestEmail: ["varchar(255)", true, false],
      guestPhone: ["varchar(50)", true, false],
      shippingAddress: ["text", true, false],
      cartId: ["integer", false, false],
      freeShipping: ["boolean", true, true],
      status: ["order_status_type", true, true],
      paymentStatus: ["payment_status_type", true, true],
      paymentMethod: ["text", true, false],
      subtotal: ["numeric(10, 2)", true, false],
      discountAmount: ["numeric(10, 2)", true, true],
      shippingAmount: ["numeric(10, 2)", true, true],
      totalAmount: ["numeric(10, 2)", true, false],
      currency: ["text", true, true],
      createdAt: ["timestamp with time zone", true, true],
      updatedAt: ["timestamp with time zone", true, true],
      paidAt: ["timestamp with time zone", false, false],
      cancelledAt: ["timestamp with time zone", false, false],
      refundedAt: ["timestamp with time zone", false, false],
    });
  });

  it("restricts deleting a user, links the cart and indexes the guest contact fields", () => {
    expect(describeForeignKeys(orders)).toEqual({
      userId: ["users", "restrict"],
      cartId: ["carts", "set null"],
    });
    expect(describeConstraints(orders)).toEqual({
      checks: ["orders_amounts_check", "orders_payment_method_check"],
      uniques: [],
      indexes: [
        "orders_cart_id_unique",
        "orders_guest_email_idx",
        "orders_guest_phone_idx",
        "orders_user_id_idx",
      ],
    });
  });

  it("refreshes updated_at on update", () => {
    const { columns } = getTableConfig(orders);

    expect(columns.find((c) => c.name === "updatedAt")?.onUpdateFn?.()).toBeInstanceOf(Date);
  });
});

describe("order_items", () => {
  it("has the specified columns", () => {
    expect(describeColumns(orderItems)).toEqual({
      id: ["serial", true, true],
      orderId: ["integer", true, false],
      productId: ["integer", false, false],
      variantId: ["integer", false, false],
      volumeMl: ["integer", false, false],
      quantity: ["integer", true, false],
      priceAtPurchase: ["numeric(10, 2)", true, false],
    });
  });

  it("cascades order deletes and keeps the row when its product or variant is deleted", () => {
    expect(describeForeignKeys(orderItems)).toEqual({
      orderId: ["orders", "cascade"],
      productId: ["products", "set null"],
      variantId: ["product_variants", "set null"],
    });
    expect(describeConstraints(orderItems)).toEqual({
      checks: ["order_items_price_at_purchase_check", "order_items_quantity_check"],
      uniques: [],
      indexes: ["order_items_order_id_idx"],
    });
  });
});

describe("shared commerce types", () => {
  it("match the rows the tables return", () => {
    expectTypeOf<typeof productVariants.$inferSelect>().toEqualTypeOf<ProductVariant>();
    expectTypeOf<typeof carts.$inferSelect>().toEqualTypeOf<Cart>();
    expectTypeOf<typeof cartItems.$inferSelect>().toEqualTypeOf<CartItem>();
    expectTypeOf<typeof orders.$inferSelect>().toEqualTypeOf<Order>();
    expectTypeOf<typeof orderItems.$inferSelect>().toEqualTypeOf<OrderItem>();
  });
});

describe("sessions", () => {
  it("has the specified columns", () => {
    expect(describeColumns(sessions)).toEqual({
      sessionId: ["uuid", true, true],
      userId: ["integer", false, false],
      anonymousId: ["text", true, false],
      startedAt: ["timestamp with time zone", true, true],
      endedAt: ["timestamp with time zone", false, false],
      landingPage: ["text", false, false],
      trafficSource: ["text", false, false],
      deviceType: ["text", false, false],
    });
  });

  it("keeps sessions when their user is deleted and has the lookup indexes", () => {
    expect(describeForeignKeys(sessions)).toEqual({ userId: ["users", "set null"] });
    expect(describeConstraints(sessions)).toEqual({
      checks: [],
      uniques: [],
      indexes: ["sessions_anonymous_id_idx", "sessions_user_id_idx"],
    });
  });
});

describe("user_events", () => {
  it("has the specified columns", () => {
    expect(describeColumns(userEvents)).toEqual({
      eventId: ["uuid", true, true],
      userId: ["integer", false, false],
      anonymousId: ["text", true, false],
      sessionId: ["uuid", true, false],
      eventType: ["text", true, false],
      productId: ["integer", false, false],
      eventProperties: ["jsonb", false, false],
      source: ["text", false, false],
      medium: ["text", false, false],
      campaign: ["text", false, false],
      deviceType: ["text", false, false],
      referrer: ["text", false, false],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("cascades session deletes and keeps events when their user or product is deleted", () => {
    expect(describeForeignKeys(userEvents)).toEqual({
      userId: ["users", "set null"],
      sessionId: ["sessions", "cascade"],
      productId: ["products", "set null"],
    });
  });

  it("checks the event type and has the analytics indexes", () => {
    expect(describeConstraints(userEvents)).toEqual({
      checks: ["user_events_event_type_check"],
      uniques: [],
      indexes: [
        "user_events_anonymous_id_idx",
        "user_events_event_type_created_at_idx",
        "user_events_session_id_idx",
        "user_events_user_id_created_at_idx",
      ],
    });
  });
});

describe("shared analytics types", () => {
  it("match the rows the tables return", () => {
    expectTypeOf<typeof sessions.$inferSelect>().toEqualTypeOf<AnalyticsSession>();
    expectTypeOf<typeof userEvents.$inferSelect>().toEqualTypeOf<UserEvent>();
  });
});
