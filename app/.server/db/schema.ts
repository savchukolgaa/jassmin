// Drizzle schema: core tables (#3), commerce tables (#4), analytics tables (#5),
// product volume variants (#26), the user role (#14), one active cart per owner (#10) and the
// checkout fields on orders (#11), the order email queue (#45), card payment attempts (#44) and
// discount rules (#59), the Strapi catalog and order sync (#40) and several fragrance families,
// notes and a store code per product (#65), gift cards with their redemptions (#125), email
// suppressions (#134), the shared rate-limit counters (#143), and password reset and email
// verification tokens (#135), and the inventory ledger with its daily view (#130).
// Names are camelCase in TS and snake_case in PostgreSQL (`casing: "snake_case"`).
//
// `users.last_login_at`, `users.acquisition_channel` and `products.fragrance_family` are
// features for LTV and churn models: never drop or rename them.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { EventProperties } from "~/lib/analytics";
import {
  AUTH_TOKEN_PURPOSES,
  type AuthTokenPurpose,
  CANCEL_REASONS,
  CART_STATUSES,
  type CancelReason,
  CMS_SYNC_ENTITIES,
  type CmsSyncEntity,
  DISCOUNT_KINDS,
  type DiscountKind,
  EMAIL_SUPPRESSION_REASONS,
  type EmailSuppressionReason,
  EVENT_TYPES,
  type EventType,
  GENDERS,
  GIFT_CARD_STATUSES,
  type GiftCardStatus,
  INVENTORY_MOVEMENT_REASONS,
  INVENTORY_MOVEMENT_SOURCES,
  type InventoryMovementReason,
  type InventoryMovementSource,
  ORDER_EMAIL_STATUSES,
  ORDER_EMAIL_TYPES,
  ORDER_STATUS_SOURCES,
  ORDER_STATUSES,
  type OrderEmailStatus,
  type OrderEmailType,
  type OrderStatusSource,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentAttemptStatus,
  type PaymentMethod,
  type PaymentProvider,
  PERFUME_VOLUMES_ML,
  USER_ROLES,
} from "~/lib/enums";
import { GIFT_CARD_AMOUNTS } from "~/lib/gift-cards";
import { LOCALES, type Locale } from "~/lib/i18n/locales";
import type { ImageFormat } from "~/lib/images";

export const genderType = pgEnum("gender_type", GENDERS);
export const orderStatusType = pgEnum("order_status_type", ORDER_STATUSES);
export const paymentStatusType = pgEnum("payment_status_type", PAYMENT_STATUSES);
export const cartStatusType = pgEnum("cart_status_type", CART_STATUSES);
export const userRoleType = pgEnum("user_role", USER_ROLES);

export const users = pgTable("users", {
  id: serial().primaryKey(),
  fullName: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  passwordHash: varchar({ length: 255 }).notNull(),
  phone: varchar({ length: 50 }),
  acquisitionChannel: text().notNull().default("direct"),
  // Read from the database on every admin request, never cached in the session cookie.
  role: userRoleType().notNull().default("customer"),
  lastLoginAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // First-touch attribution (#18): how the person first came to the site, copied once from their
  // earliest analytics session when they log in or register. `null` until then.
  firstTouchSource: text(),
  firstTouchMedium: text(),
  firstTouchCampaign: text(),
  // Password reset and email verification (#135). `null` until the user confirms their email;
  // users from before #135 start unverified. Verification is soft: nothing requires it.
  emailVerifiedAt: timestamp({ withTimezone: true }),
  // When the password was last set by a reset or a profile change: session cookies issued before
  // it are rejected, which logs out every other session (`isSessionRevoked`).
  passwordChangedAt: timestamp({ withTimezone: true }),
  // Customer attributes for segmentation and churn (#128); ML features, never drop or rename.
  /** The delivery city of the user's latest order; `null` before their first order. */
  city: text(),
  /** Agreed to marketing emails at registration or on the profile; withdrawable any time. */
  marketingOptIn: boolean().notNull().default(false),
});

/**
 * One-time links emailed for a password reset or an email verification (#135). Only the SHA-256
 * of the token is stored; the token itself exists only in the email. A link works once
 * (`used_at`) and until `expires_at`.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: serial().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text().$type<AuthTokenPurpose>().notNull(),
    /** Hex SHA-256 of the emailed token. */
    tokenHash: varchar({ length: 64 }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("auth_tokens_token_hash_unique").on(t.tokenHash),
    check("auth_tokens_purpose_check", oneOf(t.purpose, AUTH_TOKEN_PURPOSES)),
    index("auth_tokens_user_id_purpose_idx").on(t.userId, t.purpose),
  ],
);

// Shared by the products, carts, orders and order_emails tables: refreshed by every query-builder
// update. Raw SQL updates must set `updated_at` themselves.
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const products = pgTable(
  "products",
  {
    id: serial().primaryKey(),
    /** Stable external key (UUID v7, generated by PostgreSQL 18's `uuidv7()`). */
    publicId: uuid().notNull().unique("products_public_id_unique").default(sql`uuidv7()`),
    title: varchar({ length: 255 }).notNull(),
    brand: varchar({ length: 255 }).notNull(),
    gender: genderType().notNull(),
    /** The primary (first) of `fragrance_families`; kept for the ML models, see the CHECK. */
    fragranceFamily: text(),
    /**
     * Every family of the product, primary first (#65); values from `FRAGRANCE_FAMILIES`, except
     * ones copied from `fragrance_family` before #65. The catalog filter matches any of them.
     */
    fragranceFamilies: text().array().notNull().default(sql`'{}'::text[]`),
    /** Scent notes in Ukrainian, in the order staff entered them (#65). */
    notes: text().array().notNull().default(sql`'{}'::text[]`),
    /** The shop's own code for the bottle, e.g. `3-D` (#65); not unique: the lists reuse codes (#66). */
    storeCode: varchar({ length: 20 }),
    /**
     * Position on `/popular`, set by staff in Strapi (#67): 1 is first, `null` means not on the
     * list. Not unique, so staff can renumber one product at a time; ties keep the sales order.
     */
    popularRank: integer(),
    /** The Ukrainian description, plain text; paragraphs are separated by a blank line. */
    description: text(),
    /** The English description (#100); the English page falls back to `description`. */
    descriptionEn: text(),
    /** @deprecated Price, volume and stock live in `product_variants` (#26); not read by the app. */
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    /** @deprecated Use `product_variants.volume_ml` (#26). */
    volumeMl: integer().notNull(),
    /** Units in the product, e.g. 3 for a set of three testers; applies to every variant. */
    packSize: integer().notNull().default(1),
    /** @deprecated Use `product_variants.stock_quantity` (#26). */
    stockQuantity: integer().notNull().default(0),
    imageUrl: text(),
    /** The original image's size in pixels, synced from Strapi (#88); `null` when unknown. */
    imageWidth: integer(),
    imageHeight: integer(),
    /**
     * Strapi's resized versions of the image (#88), absolute URLs, for the `srcset`. `null` when
     * unknown (a product not synced since #88); an empty array when Strapi made none.
     */
    imageFormats: jsonb().$type<ImageFormat[]>(),
    /** URL slug edited in Strapi (#40); `null` for products not yet synced from it. */
    slug: varchar({ length: 255 }).unique("products_slug_unique"),
    /**
     * `false` once the product is archived or deleted in Strapi (#40). Inactive products aren't
     * listed or sold, but the row stays so historical orders keep their title and image.
     */
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Last edit of the product row (e.g. a Strapi save); the sitemap's `lastmod` (#87). */
    updatedAt: updatedAt(),
  },
  (t) => [
    check("products_stock_quantity_check", sql`${t.stockQuantity} >= 0`),
    check("products_pack_size_check", sql`${t.packSize} > 0`),
    check("products_popular_rank_check", sql`${t.popularRank} > 0`),
    check(
      "products_fragrance_family_primary_check",
      sql`${t.fragranceFamily} is not distinct from ${t.fragranceFamilies}[1]`,
    ),
    index("products_gender_idx").on(t.gender),
    index("products_fragrance_families_idx").using("gin", t.fragranceFamilies),
  ],
);

/** One sellable size of a product, with its own price and (when tracked, #98) stock. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: serial().primaryKey(),
    /** Stable external key, used in forms (`variantId`) instead of the serial id. */
    publicId: uuid().notNull().unique("product_variants_public_id_unique").default(sql`uuidv7()`),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Volume of one unit, one of `PERFUME_VOLUMES_ML`; the total is `packSize * volumeMl`. */
    volumeMl: integer().notNull(),
    /** Exact decimal, returned as a string (e.g. `"2450.00"`). */
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    stockQuantity: integer().notNull().default(0),
    /**
     * Whether `stockQuantity` limits sales (#98). `false` (the default): the shop pours from large
     * bottles, so the size is always available and checkout neither checks nor decrements stock.
     */
    trackStock: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("product_variants_product_id_volume_ml_unique").on(t.productId, t.volumeMl),
    check(
      "product_variants_volume_ml_check",
      sql`${t.volumeMl} in (${sql.join(
        PERFUME_VOLUMES_ML.map((v) => sql.raw(String(v))),
        sql`, `,
      )})`,
    ),
    check("product_variants_price_check", sql`${t.price} >= 0`),
    check("product_variants_stock_quantity_check", sql`${t.stockQuantity} >= 0`),
    index("product_variants_product_id_idx").on(t.productId),
  ],
);

/**
 * A product's former URL slugs (#83), written by the CMS sync when staff rename a slug, so
 * `/products/<old slug>` answers 301 to the current one. A slug is in here at most once, and never
 * while it is some product's current slug.
 */
export const productSlugHistory = pgTable(
  "product_slug_history",
  {
    slug: varchar({ length: 255 }).primaryKey(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_slug_history_product_id_idx").on(t.productId)],
);

// Analytics visitor sessions (#5), written by #18. Not the auth cookie session (session.ts).
export const sessions = pgTable(
  "sessions",
  {
    sessionId: uuid().primaryKey().default(sql`uuidv7()`),
    /** Filled in after login or registration (#18); set to `null` when the user is deleted. */
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    /** Visitor id from the `anonymous_id` cookie, so pre-signup behaviour can be linked. */
    anonymousId: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Time of the last request in the session; it ends after 30 minutes without one (#18). */
    endedAt: timestamp({ withTimezone: true }),
    landingPage: text(),
    // Where this visit came from (#18): `utm_source` / external referrer host / `direct`, the
    // `utm_medium` (or `referral` / `none`) and `utm_campaign`. Copied onto the session's events.
    trafficSource: text(),
    trafficMedium: text(),
    trafficCampaign: text(),
    deviceType: text(),
  },
  (t) => [
    index("sessions_anonymous_id_idx").on(t.anonymousId),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

// Behavioural event stream for conversion, LTV and churn features (#5), written by #18.
export const userEvents = pgTable(
  "user_events",
  {
    eventId: uuid().primaryKey().default(sql`uuidv7()`),
    /** Filled in after login or registration (#18); set to `null` when the user is deleted. */
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    anonymousId: text().notNull(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    eventType: text().$type<EventType>().notNull(),
    /** Set to `null` when the product is deleted, so the event history is kept. */
    productId: integer().references(() => products.id, { onDelete: "set null" }),
    eventProperties: jsonb().$type<EventProperties>(),
    // UTM parameters.
    source: text(),
    medium: text(),
    campaign: text(),
    deviceType: text(),
    referrer: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "user_events_event_type_check",
      sql`${t.eventType} in (${sql.join(
        EVENT_TYPES.map((e) => sql.raw(`'${e}'`)),
        sql`, `,
      )})`,
    ),
    index("user_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("user_events_anonymous_id_idx").on(t.anonymousId),
    index("user_events_event_type_created_at_idx").on(t.eventType, t.createdAt),
    index("user_events_session_id_idx").on(t.sessionId),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: serial().primaryKey(),
    /** Restrict: a user with carts can't be deleted, so the cart history stays linked. */
    userId: integer().references(() => users.id, { onDelete: "restrict" }),
    /** Analytics visitor session; set to `null` when the session is deleted. */
    sessionId: uuid().references(() => sessions.sessionId, { onDelete: "set null" }),
    status: cartStatusType().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    /**
     * When the abandoned-cart job (#19) marked the cart `abandoned`; `null` otherwise. The job
     * leaves `updated_at` alone, so it stays the shopper's last activity.
     */
    abandonedAt: timestamp({ withTimezone: true }),
    /**
     * The promo code the shopper applied (#59); `null` without one. Automatic rules aren't stored,
     * they are worked out again on every read.
     */
    discountId: integer().references((): AnyPgColumn => discounts.id, { onDelete: "set null" }),
    /**
     * The gift card applied at checkout (#125); `null` without one. Checked again, and its balance
     * taken, when the order is placed.
     */
    giftCardId: integer().references((): AnyPgColumn => giftCards.id, { onDelete: "set null" }),
  },
  (t) => [
    index("carts_user_id_idx").on(t.userId),
    index("carts_session_id_idx").on(t.sessionId),
    // For the abandoned-cart job (#19): active carts not updated for a while.
    index("carts_status_updated_at_idx").on(t.status, t.updatedAt),
    // One active cart per user and per guest session (#10), so concurrent adds can't create two.
    uniqueIndex("carts_active_user_id_unique")
      .on(t.userId)
      .where(sql`${t.status} = 'active' and ${t.userId} is not null`),
    uniqueIndex("carts_active_guest_session_id_unique")
      .on(t.sessionId)
      .where(sql`${t.status} = 'active' and ${t.userId} is null`),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: serial().primaryKey(),
    cartId: integer()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The chosen size; must belong to `productId`. */
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer().notNull().default(1),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One line per size, so 10 ml and 50 ml of the same perfume are separate lines.
    unique("cart_items_cart_id_variant_id_unique").on(t.cartId, t.variantId),
    check("cart_items_quantity_check", sql`${t.quantity} > 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: serial().primaryKey(),
    /** `null` for guests. Restrict: a user with orders can't be deleted. */
    userId: integer().references(() => users.id, { onDelete: "restrict" }),
    // Always stored, also for registered users, for identity resolution in LTV models.
    guestFullName: varchar({ length: 255 }).notNull(),
    guestEmail: varchar({ length: 255 }).notNull(),
    guestPhone: varchar({ length: 50 }).notNull(),
    /** Nova Poshta delivery details. */
    shippingAddress: text().notNull(),
    /**
     * The cart this order was placed from (#11); one order per cart, so a double submit can't
     * create two. Set to `null` when the cart is deleted.
     */
    cartId: integer().references(() => carts.id, { onDelete: "set null" }),
    /** The store pays Nova Poshta (subtotal at or above the free-shipping threshold, #11). */
    freeShipping: boolean().notNull().default(false),
    status: orderStatusType().notNull().default("pending"),
    paymentStatus: paymentStatusType().notNull().default("unpaid"),
    paymentMethod: text().$type<PaymentMethod>().notNull(),
    // Exact decimals, returned as strings and computed on the server.
    subtotal: numeric({ precision: 10, scale: 2 }).notNull(),
    discountAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    shippingAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    /**
     * What a gift card paid (#125), taken off after the discount and delivery. `total_amount` is
     * what is left to pay, so the order's full price is `total_amount + gift_card_amount`.
     */
    giftCardAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    totalAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default("UAH"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    paidAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    refundedAt: timestamp({ withTimezone: true }),
    /** When the order was marked `shipped` (#40); with `completed_at`, a delivery-time feature. */
    shippedAt: timestamp({ withTimezone: true }),
    /** When the order was marked `completed` (#40). */
    completedAt: timestamp({ withTimezone: true }),
    /**
     * When the parcel arrived at the Nova Poshta branch (#138): set by the app when staff tick
     * "arrived" in Strapi (later by the tracking job, #137). A delivery-time feature for the
     * LTV/churn models, like `shipped_at`: never drop or rename it.
     */
    arrivedAt: timestamp({ withTimezone: true }),
    /** The Nova Poshta waybill number (ТТН, 14 digits, #138), entered by staff in Strapi. */
    waybillNumber: varchar({ length: 20 }),
    /**
     * The discount rule applied at checkout (#59), for attributing orders to promotions. Restrict:
     * a used rule is deactivated, never deleted.
     */
    discountId: integer().references((): AnyPgColumn => discounts.id, { onDelete: "restrict" }),
    /**
     * When the parcel came back (#128): set when the status becomes `returned` or `unclaimed`.
     * With `shipped_at`, the time-to-return feature; never drop or rename it.
     */
    returnedAt: timestamp({ withTimezone: true }),
    /** Why the order was cancelled (#128); set with `cancelled`, `null` for older orders. */
    cancelReason: text().$type<CancelReason>(),
  },
  (t) => [
    check(
      "orders_payment_method_check",
      sql`${t.paymentMethod} in (${sql.join(
        PAYMENT_METHODS.map((m) => sql.raw(`'${m}'`)),
        sql`, `,
      )})`,
    ),
    check(
      "orders_amounts_check",
      sql`${t.subtotal} >= 0 and ${t.discountAmount} >= 0 and ${t.shippingAmount} >= 0 and ${t.giftCardAmount} >= 0 and ${t.totalAmount} >= 0`,
    ),
    // `gift_card` is only for orders a gift card paid in full (#125).
    check(
      "orders_gift_card_payment_check",
      sql`${t.paymentMethod} <> 'gift_card' or (${t.totalAmount} = 0 and ${t.giftCardAmount} > 0)`,
    ),
    check("orders_waybill_number_check", sql`${t.waybillNumber} ~ '^[0-9]{14}$'`),
    index("orders_guest_email_idx").on(t.guestEmail),
    index("orders_guest_phone_idx").on(t.guestPhone),
    index("orders_user_id_idx").on(t.userId),
    // NULLs don't collide, so orders without a cart are fine.
    uniqueIndex("orders_cart_id_unique").on(t.cartId),
    index("orders_discount_id_idx").on(t.discountId),
    check("orders_cancel_reason_check", oneOf(t.cancelReason, CANCEL_REASONS)),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial().primaryKey(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Set to `null` when the product is deleted, so historical revenue is kept. */
    productId: integer().references(() => products.id, { onDelete: "set null" }),
    /** The bought size; `null` once the variant is deleted (or for lines before #26). */
    variantId: integer().references(() => productVariants.id, { onDelete: "set null" }),
    /** Snapshot of the bought size, kept when the variant is deleted. */
    volumeMl: integer(),
    quantity: integer().notNull(),
    /** Unit price when the order was placed; later price changes don't affect it. */
    priceAtPurchase: numeric({ precision: 10, scale: 2 }).notNull(),
    /**
     * This line's share of `orders.discount_amount` (#128), for the whole line (not per unit).
     * The lines of an order add up to its discount exactly.
     */
    discountAllocated: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    check("order_items_quantity_check", sql`${t.quantity} > 0`),
    check("order_items_price_at_purchase_check", sql`${t.priceAtPurchase} >= 0`),
    check("order_items_discount_allocated_check", sql`${t.discountAllocated} >= 0`),
    index("order_items_order_id_idx").on(t.orderId),
  ],
);

/**
 * One row per change of an order's status (#128), written in the transaction that made it:
 * checkout, the payment callback, a Strapi edit or a job. `orders.status` is only the latest.
 */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: serial().primaryKey(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatusType().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    source: text().$type<OrderStatusSource>().notNull(),
  },
  (t) => [
    check("order_status_history_source_check", oneOf(t.source, ORDER_STATUS_SOURCES)),
    index("order_status_history_order_id_changed_at_idx").on(t.orderId, t.changedAt),
  ],
);

/**
 * Append-only ledger of every change to a tracked size's stock (#130), written in the transaction
 * that changed `product_variants.stock_quantity`: a sale at checkout, units put back by a cancel or
 * an unclaimed parcel, a receipt or correction in Strapi, or the opening balance. A trigger
 * (`inventory_movements_append_only`, migration 0029) refuses updates and deletes, except the
 * order FK's `set null`. For every tracked size, `sum(quantity_delta) = stock_quantity`.
 * ML features for demand forecasting: never drop or rename these columns.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: serial().primaryKey(),
    variantId: integer()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reason: text().$type<InventoryMovementReason>().notNull(),
    quantityDelta: integer().notNull(),
    stockAfter: integer().notNull(),
    orderId: integer().references(() => orders.id, { onDelete: "set null" }),
    source: text().$type<InventoryMovementSource>().notNull(),
    note: text(),
  },
  (t) => [
    check("inventory_movements_reason_check", oneOf(t.reason, INVENTORY_MOVEMENT_REASONS)),
    check("inventory_movements_source_check", oneOf(t.source, INVENTORY_MOVEMENT_SOURCES)),
    check("inventory_movements_quantity_delta_check", sql`${t.quantityDelta} <> 0`),
    check("inventory_movements_stock_after_check", sql`${t.stockAfter} >= 0`),
    index("inventory_movements_variant_id_occurred_at_idx").on(t.variantId, t.occurredAt),
  ],
);

/**
 * One row per currently tracked size and day (Europe/Kyiv) from its first movement to today
 * (#130): units sold, the stock at the end of the day and whether it ran out that day. Defined by
 * hand in migration 0029, so drizzle-kit leaves it alone (`.existing()`).
 */
export const inventoryDaily = pgView("inventory_daily", {
  variantId: integer().notNull(),
  day: date().notNull(),
  unitsSold: integer().notNull(),
  closingStock: integer().notNull(),
  wasOutOfStock: boolean().notNull(),
}).existing();

/** `<column> in ('a', 'b', …)` for a CHECK constraint over a fixed list of values. */
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} in (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  )})`;
}

/**
 * Outbox for emails about an order (#45). The confirmation is queued in the order's own
 * transaction, sent right after the commit and retried by `pnpm db:send-order-emails` until it
 * goes out or runs out of attempts. A sender claims a row by pushing `next_attempt_at` out (a
 * lease), so a crash mid-send means another try later rather than a lost email.
 */
export const orderEmails = pgTable(
  "order_emails",
  {
    id: serial().primaryKey(),
    /** The order this email is about; `null` for a gift card's email. */
    orderId: integer().references(() => orders.id, { onDelete: "cascade" }),
    /** The gift card whose code this email sends (#125); `null` for an order's email. */
    giftCardId: integer().references((): AnyPgColumn => giftCards.id, { onDelete: "cascade" }),
    type: text().$type<OrderEmailType>().notNull(),
    /** The language the shopper checked out (or bought the gift card) in. */
    locale: text().$type<Locale>().notNull(),
    status: text().$type<OrderEmailStatus>().notNull().default("pending"),
    /** Send attempts so far, counted when a sender claims the row. */
    attempts: integer().notNull().default(0),
    /** When the row is next due; claiming moves it to the retry time. */
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** The last failure's message, without the email body; a bounce's reason (#134). */
    lastError: text(),
    sentAt: timestamp({ withTimezone: true }),
    /** The Message-ID it was sent with (#134), to match a later bounce; `null` until sent. */
    messageId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("order_emails_type_check", oneOf(t.type, ORDER_EMAIL_TYPES)),
    check("order_emails_locale_check", oneOf(t.locale, LOCALES)),
    check("order_emails_status_check", oneOf(t.status, ORDER_EMAIL_STATUSES)),
    check("order_emails_attempts_check", sql`${t.attempts} >= 0`),
    unique("order_emails_order_id_type_unique").on(t.orderId, t.type),
    unique("order_emails_gift_card_id_type_unique").on(t.giftCardId, t.type),
    check("order_emails_target_check", sql`(${t.orderId} is null) <> (${t.giftCardId} is null)`),
    index("order_emails_status_next_attempt_at_idx").on(t.status, t.nextAttemptAt),
  ],
);

/**
 * One attempt at paying a card order online (#44). Every retry is a new row with its own
 * `reference` (`<order id>-<attempt>`), because providers want a fresh id per attempt and the
 * success page reads the latest attempt to tell "failed" from "pending". The amount is the
 * order's `total_amount` when the attempt started; a callback for another amount is ignored.
 */
export const payments = pgTable(
  "payments",
  {
    id: serial().primaryKey(),
    /** The card order being paid; `null` for a gift card purchase. */
    orderId: integer().references(() => orders.id, { onDelete: "cascade" }),
    /** The gift card being bought (#125); `null` for an order's payment. */
    giftCardId: integer().references((): AnyPgColumn => giftCards.id, { onDelete: "cascade" }),
    provider: text().$type<PaymentProvider>().notNull(),
    /**
     * Sent to the provider as its order id: `<order id>-<attempt number>`, or
     * `G<gift card id>-<attempt number>` for a gift card.
     */
    reference: text().notNull(),
    status: text().$type<PaymentAttemptStatus>().notNull().default("pending"),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default("UAH"),
    /** The provider's own id for the payment, from its callback. */
    providerPaymentId: text(),
    /** The last verified callback's decoded payload, for support and analytics. */
    lastCallback: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    /** When a callback moved the attempt to `succeeded` or `failed`. */
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("payments_provider_check", oneOf(t.provider, PAYMENT_PROVIDERS)),
    check("payments_status_check", oneOf(t.status, PAYMENT_ATTEMPT_STATUSES)),
    check("payments_amount_check", sql`${t.amount} >= 0`),
    unique("payments_reference_unique").on(t.reference),
    index("payments_order_id_idx").on(t.orderId),
    index("payments_gift_card_id_idx").on(t.giftCardId),
    // An attempt pays exactly one thing: an order or a gift card.
    check("payments_target_check", sql`(${t.orderId} is null) <> (${t.giftCardId} is null)`),
  ],
);

/**
 * Gift cards (#125): bought online by card in 500, 1000 or 2000 ₴ and spent at checkout, across
 * as many orders as it takes, until the balance runs out or 12 months pass. A card is created
 * `pending` with its code and full balance, and only becomes usable (`active`) when its payment
 * succeeds; that also starts its 12 months.
 */
export const giftCards = pgTable(
  "gift_cards",
  {
    id: serial().primaryKey(),
    /** 16 symbols of Crockford's base 32, uppercase without separators (`~/lib/gift-cards`). */
    code: varchar({ length: 16 }).notNull(),
    initialAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    /** What can still be spent; lowered by each redemption. */
    balance: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default("UAH"),
    status: text().$type<GiftCardStatus>().notNull().default("pending"),
    /** The logged-in buyer; `null` for a guest. Restrict, like orders. */
    buyerUserId: integer().references(() => users.id, { onDelete: "restrict" }),
    /** Where the code is sent. */
    buyerEmail: varchar({ length: 255 }).notNull(),
    /** Who the card is for, when the buyer named them: the code is sent there too. */
    recipientEmail: varchar({ length: 255 }),
    /** The language the card was bought in, for its emails. */
    locale: text().$type<Locale>().notNull(),
    /** The attempt that paid for the card. */
    paymentId: integer().references((): AnyPgColumn => payments.id, { onDelete: "set null" }),
    activatedAt: timestamp({ withTimezone: true }),
    /** `activated_at` + 12 months; the card can't be used from then on. */
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("gift_cards_code_unique").on(t.code),
    check("gift_cards_status_check", oneOf(t.status, GIFT_CARD_STATUSES)),
    check("gift_cards_locale_check", oneOf(t.locale, LOCALES)),
    check(
      "gift_cards_initial_amount_check",
      sql`${t.initialAmount} in (${sql.raw(GIFT_CARD_AMOUNTS.join(", "))})`,
    ),
    check(
      "gift_cards_balance_check",
      sql`${t.balance} >= 0 and ${t.balance} <= ${t.initialAmount}`,
    ),
    check(
      "gift_cards_activation_check",
      sql`${t.status} = 'pending' or (${t.activatedAt} is not null and ${t.expiresAt} is not null)`,
    ),
    index("gift_cards_buyer_user_id_idx").on(t.buyerUserId),
    // For the expiry job: active cards past their date.
    index("gift_cards_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);

/**
 * What each order took off a gift card (#125). A cancelled or unclaimed order gives the amount
 * back and keeps the row with `reversed_at` set.
 */
export const giftCardRedemptions = pgTable(
  "gift_card_redemptions",
  {
    id: serial().primaryKey(),
    /** Restrict: a card that paid for an order is never deleted. */
    giftCardId: integer()
      .notNull()
      .references(() => giftCards.id, { onDelete: "restrict" }),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** When the amount went back on the card because the order was cancelled or unclaimed. */
    reversedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("gift_card_redemptions_amount_check", sql`${t.amount} > 0`),
    unique("gift_card_redemptions_gift_card_id_order_id_unique").on(t.giftCardId, t.orderId),
    index("gift_card_redemptions_order_id_idx").on(t.orderId),
  ],
);

/**
 * Discount rules (#59). A rule with a `code` applies only when the shopper enters it; one without
 * applies by itself when the cart qualifies. Checkout picks the single best rule for the cart and
 * counts it in `redemption_count`, which can never pass `max_redemptions`.
 *
 * A cart line qualifies when it matches every scope that is set (`null` = any): the unit volume,
 * the product's `public_id` and its `pack_size`.
 */
export const discounts = pgTable(
  "discounts",
  {
    id: serial().primaryKey(),
    /** Stable internal key, for the seed and for linking a rule from elsewhere. */
    slug: text().notNull(),
    /** Stored uppercase and unique whatever its case; `null` for automatic rules. */
    code: varchar({ length: 40 }),
    kind: text().$type<DiscountKind>().notNull(),
    /**
     * The percent for `percent` and `percent_every_nth`, the hryvnias off for `fixed_amount` and
     * the price of one set for `fixed_price_set`.
     */
    value: numeric({ precision: 10, scale: 2 }).notNull(),
    scopeVolumesMl: integer().array(),
    scopeProductPublicIds: uuid().array(),
    scopePackSize: integer(),
    /**
     * Qualifying units the cart needs; for `fixed_price_set` the size of one set, and for
     * `percent_every_nth` the size of one group (2: every second unit is discounted).
     */
    minQuantity: integer().notNull().default(1),
    /** For `fixed_price_set` and `percent_every_nth`: the most sets (groups) one order gets. */
    maxSets: integer(),
    /** Start inclusive, end exclusive; `null` means no limit on that side. */
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    /** `null` for no limit. */
    maxRedemptions: integer(),
    /** Orders placed with the rule. */
    redemptionCount: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("discounts_slug_unique").on(t.slug),
    uniqueIndex("discounts_code_unique").on(sql`lower(${t.code})`),
    check("discounts_kind_check", oneOf(t.kind, DISCOUNT_KINDS)),
    check(
      "discounts_value_check",
      sql`${t.value} >= 0 and (${t.kind} not in ('percent', 'percent_every_nth') or (${t.value} > 0 and ${t.value} <= 100))`,
    ),
    check(
      "discounts_min_quantity_check",
      sql`${t.minQuantity} >= 1 and (${t.kind} not in ('fixed_price_set', 'percent_every_nth') or ${t.minQuantity} >= 2)`,
    ),
    check("discounts_max_sets_check", sql`${t.maxSets} is null or ${t.maxSets} > 0`),
    check(
      "discounts_window_check",
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
    check(
      "discounts_redemptions_check",
      sql`${t.redemptionCount} >= 0 and (${t.maxRedemptions} is null or (${t.maxRedemptions} > 0 and ${t.redemptionCount} <= ${t.maxRedemptions}))`,
    ),
  ],
);

/**
 * Outbox of app changes to push to Strapi (#40): one row per order or product whose current
 * state Strapi should show. Rows are queued in the transaction that made the change; queuing an
 * already-queued entity bumps `version`, so a push that started before the change can't mark the
 * newer state as synced. Like `order_emails`, a sender claims a row by pushing `next_attempt_at`
 * out (a lease), and a push sends the entity's whole current state, so repeats are harmless.
 */
export const cmsOutbox = pgTable(
  "cms_outbox",
  {
    id: serial().primaryKey(),
    entity: text().$type<CmsSyncEntity>().notNull(),
    /** `orders.id` or `products.id`; no FK, since it points at either table. */
    entityId: integer().notNull(),
    /** Bumped by every enqueue; a push only marks the version it claimed as synced. */
    version: integer().notNull().default(1),
    /** Push attempts since the last enqueue, counted when a sender claims the row. */
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    /** `null` while a push is due. */
    syncedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("cms_outbox_entity_check", oneOf(t.entity, CMS_SYNC_ENTITIES)),
    check("cms_outbox_attempts_check", sql`${t.attempts} >= 0`),
    unique("cms_outbox_entity_entity_id_unique").on(t.entity, t.entityId),
    index("cms_outbox_synced_at_next_attempt_at_idx").on(t.syncedAt, t.nextAttemptAt),
  ],
);

/**
 * Addresses that get no more email (#134): the email provider's webhook (`/hooks/email`) adds a
 * hard bounce or a spam complaint here, and every send skips them (`withSuppressions` in
 * `mail.ts`). One row per address, stored lowercase; the first reason wins. To send to an address
 * again, delete its row (see docs/email.md).
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    address: text().primaryKey(),
    reason: text().$type<EmailSuppressionReason>().notNull(),
    /** The provider's own words for it, e.g. the bounce's SMTP reply. */
    detail: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("email_suppressions_reason_check", oneOf(t.reason, EMAIL_SUPPRESSION_REASONS)),
    check("email_suppressions_address_lowercase_check", sql`${t.address} = lower(${t.address})`),
  ],
);

/**
 * Fixed-window rate-limit counters (#143), shared by every app instance and kept across restarts.
 * `key` is `<limiter name>:<sha256 of the key>`, so no email or IP is stored in plain text. Rows
 * whose window ended are harmless (the next hit restarts them) and `pnpm db:prune-rate-limits`
 * deletes them.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: varchar({ length: 200 }).primaryKey(),
    count: integer().notNull(),
    resetAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check("rate_limits_count_check", sql`${t.count} > 0`),
    index("rate_limits_reset_at_idx").on(t.resetAt),
  ],
);
