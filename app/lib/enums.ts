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
