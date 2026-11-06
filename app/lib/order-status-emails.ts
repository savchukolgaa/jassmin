// Which order status emails a lifecycle change sends (#138). Isomorphic and pure: the services
// queue the returned types in the change's own transaction, and the outbox's unique
// `(order_id, type)` keeps each one to a single email per order.
import type { OrderEmailType } from "./enums";
import type { OrderLifecyclePatch } from "./order-status";

/** The order status emails, in the order a change that triggers several queues them. */
export const ORDER_STATUS_EMAIL_TYPES = [
  "shipped",
  "arrived",
  "cancelled",
  "refunded",
] as const satisfies readonly OrderEmailType[];

export type OrderStatusEmailType = (typeof ORDER_STATUS_EMAIL_TYPES)[number];

export function isOrderStatusEmailType(type: OrderEmailType): type is OrderStatusEmailType {
  return (ORDER_STATUS_EMAIL_TYPES as readonly OrderEmailType[]).includes(type);
}

/**
 * The emails `patch` (from `nextOrderState`) calls for: the order became `shipped` or
 * `cancelled`, the parcel arrived at the branch, or the payment was `refunded`. Paid, completed,
 * returned and unclaimed orders, a waybill edit and an empty patch send nothing. Cancelling and
 * refunding in one change sends both.
 */
export function orderStatusEmailTypes(patch: OrderLifecyclePatch): OrderStatusEmailType[] {
  const types: OrderStatusEmailType[] = [];
  if (patch.status === "shipped") types.push("shipped");
  if (patch.arrivedAt instanceof Date) types.push("arrived");
  if (patch.status === "cancelled") types.push("cancelled");
  if (patch.paymentStatus === "refunded") types.push("refunded");
  return types;
}
