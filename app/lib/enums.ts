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

/** What a user may do: `admin` can open the `/admin` area (#14). */
export const USER_ROLES = ["customer", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];
