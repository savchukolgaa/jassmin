// Values of the PostgreSQL enums. The Drizzle schema (app/.server/db/schema.ts) builds its
// `pgEnum`s from these arrays, so the database and the TS unions can't drift apart.

export const GENDERS = ["women", "men", "unisex"] as const;

export type Gender = (typeof GENDERS)[number];

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "returned",
  "unclaimed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const CART_STATUSES = ["active", "converted", "abandoned"] as const;

export type CartStatus = (typeof CART_STATUSES)[number];

/** How the shopper pays: online by card or cash on delivery (`cod`). */
export const PAYMENT_METHODS = ["card", "cod"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Behavioural events stored in `user_events.event_type`, which a CHECK constraint limits to
 * these values.
 */
export const EVENT_TYPES = [
  "page_view",
  "product_view",
  "search",
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "purchase",
  "login",
  "review_submit",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Bottle sizes a perfume can be sold in, ascending: samples (5 ml), testers (10 ml) and full
 * bottles. 7 ml was dropped in #66.
 */
export const PERFUME_VOLUMES_ML = [5, 10, 30, 50, 100] as const;

export type PerfumeVolumeMl = (typeof PERFUME_VOLUMES_ML)[number];

/** What a user may do: `admin` passes `requireAdmin` (#14); the shop is managed in Strapi (#40). */
export const USER_ROLES = ["customer", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Emails queued per order in `order_emails.type` (#45); a CHECK constraint limits it. */
export const ORDER_EMAIL_TYPES = ["confirmation"] as const;

export type OrderEmailType = (typeof ORDER_EMAIL_TYPES)[number];

/**
 * Delivery state of a queued order email: `pending` until sent, `failed` once every retry is
 * used up. A CHECK constraint limits `order_emails.status` to these values.
 */
export const ORDER_EMAIL_STATUSES = ["pending", "sent", "failed"] as const;

export type OrderEmailStatus = (typeof ORDER_EMAIL_STATUSES)[number];

/**
 * Where card payments go (#44). Only the local `simulator` for now (never in production); a real
 * provider joins this list with a migration that rewrites the `payments_provider_check`.
 */
export const PAYMENT_PROVIDERS = ["simulator"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * State of one payment attempt in `payments.status` (#44): `pending` until the provider's
 * callback says it `succeeded` or `failed`. A CHECK constraint limits it to these values.
 */
export const PAYMENT_ATTEMPT_STATUSES = ["pending", "succeeded", "failed"] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/** What the app pushes to Strapi through `cms_outbox` (#40); a CHECK constraint limits it. */
export const CMS_SYNC_ENTITIES = ["order", "product"] as const;

export type CmsSyncEntity = (typeof CMS_SYNC_ENTITIES)[number];

/**
 * How a discount rule (#59) takes money off: a percentage of the qualifying lines, a fixed amount
 * off them, a fixed price for each set of `min_quantity` qualifying units, or a percentage off
 * every `min_quantity`-th qualifying unit, dearest first (the couple offer, #124). A CHECK
 * constraint limits `discounts.kind` to these values.
 */
export const DISCOUNT_KINDS = [
  "percent",
  "fixed_amount",
  "fixed_price_set",
  "percent_every_nth",
] as const;

export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/**
 * The fragrance families a product can have (#65), lowercase Ukrainian as stored in
 * `products.fragrance_families` and used in the catalog's `fragrance_family` URL param. Labels
 * live in `catalog.families.*` (`FRAGRANCE_FAMILY_LABEL_KEYS` in `~/lib/catalog`). Rows written
 * before #65 may hold other values, so reads stay `string`.
 */
export const FRAGRANCE_FAMILIES = [
  "квіткові",
  "фруктові",
  "східні",
  "водяні",
  "шипрові",
  "деревні",
  "мускусні",
  "пряні",
  "гурманські",
  "зелені",
  "ванільні",
  "ароматичні",
  "альдегідні",
  "цитрусові",
  "свіжі",
  "фужерні",
] as const;

export type FragranceFamily = (typeof FRAGRANCE_FAMILIES)[number];

export function isFragranceFamily(value: string): value is FragranceFamily {
  return (FRAGRANCE_FAMILIES as readonly string[]).includes(value);
}
