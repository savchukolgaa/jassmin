// Order lifecycle rules (#40): which status and payment status changes staff may make in the
// Strapi admin, the timestamps each change sets and when stock goes back on sale. Isomorphic: no
// server imports. The app applies them in `applyCmsOrderChange`, inside the order's transaction.
import type { OrderStatus, PaymentMethod, PaymentStatus } from "./enums";

/** Where an order may go from each status. Final statuses have no way out. */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // `shipped` straight from `pending` is for cash on delivery only (see `nextOrderState`).
  pending: ["paid", "shipped", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed", "returned", "unclaimed"],
  completed: ["returned"],
  cancelled: [],
  returned: [],
  unclaimed: [],
};

export const PAYMENT_STATUS_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> =
  {
    unpaid: ["paid"],
    paid: ["refunded"],
    refunded: [],
  };

/**
 * Statuses that put the order's units back in stock: a cancelled order never left, and an
 * unclaimed parcel comes back unopened. A `returned` perfume may have been opened, so it doesn't.
 */
export const RESTOCK_STATUSES: readonly OrderStatus[] = ["cancelled", "unclaimed"];

/** The parts of an order the lifecycle rules read. */
export interface OrderLifecycle {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paidAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  shippedAt: Date | null;
  completedAt: Date | null;
  /** When the parcel arrived at the Nova Poshta branch (#138). */
  arrivedAt: Date | null;
  /** The Nova Poshta waybill number (ТТН, 14 digits, #138). */
  waybillNumber: string | null;
}

/** What staff asked for; a missing field stays as it is. */
export interface OrderStatusChange {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  /**
   * The parcel is at the Nova Poshta branch (#138): `true` sets `arrived_at` (only for a
   * `shipped` order), `false` clears it, `null` (an untouched checkbox) changes nothing.
   */
  arrivedAtBranch?: boolean | null;
  /** The waybill number, already normalised to 14 digits; `null` removes it. */
  waybillNumber?: string | null;
}

/** The columns to update: only the ones that change. */
export type OrderLifecyclePatch = Partial<Omit<OrderLifecycle, "paymentMethod">>;

export type OrderTransitionError =
  | "invalid-transition"
  | "invalid-payment-transition"
  // A card order has to be paid before it ships; cash on delivery is paid at the door.
  | "card-not-paid"
  // Only a parcel on its way can arrive at the branch (#138).
  | "arrived-not-shipped";

export type NextOrderState =
  | { ok: true; patch: OrderLifecyclePatch; restock: boolean }
  | { ok: false; error: "invalid-transition" | "card-not-paid"; from: OrderStatus; to: OrderStatus }
  | {
      ok: false;
      error: "invalid-payment-transition";
      from: PaymentStatus;
      to: PaymentStatus;
    }
  | { ok: false; error: "arrived-not-shipped"; status: OrderStatus };

export function canChangeOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export function canChangePaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Applies `change` to `order`. Asking for the current value is not a change. Besides the asked
 * fields, the patch:
 * - marks the payment `paid` when the order moves to `paid`, or when a cash-on-delivery order is
 *   `completed` (the cash was collected at the door);
 * - moves a `pending` order to `paid` when its payment becomes `paid`;
 * - sets `paid_at`, `refunded_at`, `shipped_at`, `completed_at` and `cancelled_at` when their
 *   state is reached and they're still empty;
 * - sets `arrived_at` when staff mark a `shipped` order (after this change) as arrived at the
 *   branch and it's still empty, or clears it when they unmark it (#138);
 * - stores a changed waybill number.
 *
 * `restock` says whether the order's units go back to stock (see `RESTOCK_STATUSES`).
 */
export function nextOrderState(
  order: OrderLifecycle,
  change: OrderStatusChange,
  now: Date,
): NextOrderState {
  let status = order.status;
  let paymentStatus = order.paymentStatus;

  if (change.status !== undefined && change.status !== order.status) {
    const to = change.status;
    if (!canChangeOrderStatus(order.status, to)) {
      return { ok: false, error: "invalid-transition", from: order.status, to };
    }
    if (
      order.status === "pending" &&
      to === "shipped" &&
      order.paymentMethod === "card" &&
      order.paymentStatus !== "paid"
    ) {
      return { ok: false, error: "card-not-paid", from: order.status, to };
    }
    status = to;
    if (
      paymentStatus === "unpaid" &&
      (to === "paid" || (to === "completed" && order.paymentMethod === "cod"))
    ) {
      paymentStatus = "paid";
    }
  }

  if (change.paymentStatus !== undefined && change.paymentStatus !== paymentStatus) {
    const to = change.paymentStatus;
    if (!canChangePaymentStatus(paymentStatus, to)) {
      return { ok: false, error: "invalid-payment-transition", from: paymentStatus, to };
    }
    paymentStatus = to;
    if (to === "paid" && status === "pending") {
      status = "paid";
    }
  }

  const patch: OrderLifecyclePatch = {};
  if (change.arrivedAtBranch === true && order.arrivedAt === null) {
    if (status !== "shipped") {
      return { ok: false, error: "arrived-not-shipped", status };
    }
    patch.arrivedAt = now;
  } else if (change.arrivedAtBranch === false && order.arrivedAt !== null) {
    patch.arrivedAt = null;
  }
  if (change.waybillNumber !== undefined && change.waybillNumber !== order.waybillNumber) {
    patch.waybillNumber = change.waybillNumber;
  }
  if (status !== order.status) patch.status = status;
  if (paymentStatus !== order.paymentStatus) patch.paymentStatus = paymentStatus;
  const reached = (column: keyof OrderLifecyclePatch & `${string}At`, when: boolean) => {
    if (when && order[column] === null) patch[column] = now;
  };
  reached("paidAt", patch.paymentStatus === "paid");
  reached("refundedAt", patch.paymentStatus === "refunded");
  reached("shippedAt", patch.status === "shipped");
  reached("completedAt", patch.status === "completed");
  reached("cancelledAt", patch.status === "cancelled");

  const restock =
    patch.status !== undefined &&
    RESTOCK_STATUSES.includes(patch.status) &&
    !RESTOCK_STATUSES.includes(order.status);
  return { ok: true, patch, restock };
}
