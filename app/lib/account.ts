// Account dashboard (#12): how orders are grouped and tracked, plus the DTOs the account loaders
// return. Isomorphic: no server imports. Amounts are exact decimal strings.
import type { OrderSummaryLine } from "./checkout";
import type { OrderStatus, PaymentMethod } from "./enums";

/** Orders still on their way to the customer. */
export const CURRENT_ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
] as const satisfies readonly OrderStatus[];

/** Orders that reached an end state; shown in the order history. */
export const PREVIOUS_ORDER_STATUSES = [
  "completed",
  "cancelled",
  "returned",
  "unclaimed",
] as const satisfies readonly OrderStatus[];

/** The steps of the progress indicator on a current order. */
export const ORDER_PROGRESS_STEPS = [
  "pending",
  "paid",
  "shipped",
  "completed",
] as const satisfies readonly OrderStatus[];

export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

export function isCurrentOrder(status: OrderStatus): boolean {
  return (CURRENT_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The status's position in `ORDER_PROGRESS_STEPS`, or `-1` for statuses off that path. */
export function orderProgressIndex(status: OrderStatus): number {
  return (ORDER_PROGRESS_STEPS as readonly OrderStatus[]).indexOf(status);
}

/** The first word of a full name, for the greeting. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** An order line with its product's picture (`null` without one or once deleted). */
export interface AccountOrderLine extends OrderSummaryLine {
  imageUrl: string | null;
}

/** An order on the account dashboard. `unitPrice` is `order_items.price_at_purchase`. */
export interface AccountOrder {
  id: number;
  status: OrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  totalAmount: string;
  /** Units bought, summed over the lines. */
  itemCount: number;
  lines: AccountOrderLine[];
}

/** An order on its account detail page. */
export interface AccountOrderDetail extends AccountOrder {
  fullName: string;
  phone: string;
  shippingAddress: string;
  paymentMethod: PaymentMethod;
  freeShipping: boolean;
  subtotal: string;
}

export interface AccountOrders {
  /** Newest first. */
  current: AccountOrder[];
  /** Newest first. */
  previous: AccountOrder[];
}
