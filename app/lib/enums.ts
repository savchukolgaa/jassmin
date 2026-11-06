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

/**
 * Why an order was cancelled (#128), stored in `orders.cancel_reason` (a CHECK limits it to these
 * values). Staff pick it in Strapi; the unpaid-order job uses `payment_failed`.
 */
export const CANCEL_REASONS = [
  "customer_request",
  "out_of_stock",
  "no_answer",
  "payment_failed",
  "other",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * What changed an order's status (#128), stored in `order_status_history.source` (a CHECK limits
 * it to these values): checkout, the payment callback, a staff edit in Strapi, or a scheduled job.
 */
export const ORDER_STATUS_SOURCES = ["checkout", "payment", "cms", "job"] as const;

export type OrderStatusSource = (typeof ORDER_STATUS_SOURCES)[number];

/**
 * How an order is paid: online by card, cash on delivery (`cod`), or entirely by a gift card
 * (#125). A CHECK constraint limits `orders.payment_method` to these values.
 */
export const PAYMENT_METHODS = ["card", "cod", "gift_card"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The methods a shopper picks at checkout. `gift_card` isn't one: the shop sets it when a gift
 * card covers the whole order.
 */
export const SELECTABLE_PAYMENT_METHODS = [
  "card",
  "cod",
] as const satisfies readonly PaymentMethod[];

export type SelectablePaymentMethod = (typeof SELECTABLE_PAYMENT_METHODS)[number];

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

/**
 * Emails queued in `order_emails.type` (#45): an order's `confirmation`, and a gift card's code to
 * its buyer (`gift_card`) and to the recipient they named (`gift_card_recipient`, #125). A CHECK
 * constraint limits it.
 */
export const ORDER_EMAIL_TYPES = ["confirmation", "gift_card", "gift_card_recipient"] as const;

export type OrderEmailType = (typeof ORDER_EMAIL_TYPES)[number];

/**
 * Delivery state of a queued order email: `pending` until sent, `failed` once every retry is
 * used up. A CHECK constraint limits `order_emails.status` to these values.
 */
export const ORDER_EMAIL_STATUSES = ["pending", "sent", "failed"] as const;

export type OrderEmailStatus = (typeof ORDER_EMAIL_STATUSES)[number];

/**
 * Why an address gets no more email (#134): a hard bounce, a spam complaint, the provider
 * blocking it, or an address that can't exist. A CHECK constraint limits
 * `email_suppressions.reason` to these values.
 */
export const EMAIL_SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "blocked",
  "invalid",
] as const;

export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

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
export const CMS_SYNC_ENTITIES = ["order", "product", "gift_card"] as const;

export type CmsSyncEntity = (typeof CMS_SYNC_ENTITIES)[number];

/**
 * A gift card's state (#125): `pending` until its payment succeeds, then `active` until its
 * balance is spent (`used_up`) or its 12 months run out (`expired`). A CHECK constraint limits
 * `gift_cards.status` to these values.
 */
export const GIFT_CARD_STATUSES = ["pending", "active", "used_up", "expired"] as const;

export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

/**
 * What a one-time emailed link in `auth_tokens` is for (#135): setting a new password or
 * confirming the email address. A CHECK constraint limits `auth_tokens.purpose` to these values.
 */
export const AUTH_TOKEN_PURPOSES = ["password_reset", "email_verification"] as const;

export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

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
