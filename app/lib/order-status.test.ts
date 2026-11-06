import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus, PAYMENT_STATUSES } from "./enums";
import {
  canChangeOrderStatus,
  canChangePaymentStatus,
  nextOrderState,
  type OrderLifecycle,
} from "./order-status";

const NOW = new Date("2026-10-25T12:00:00Z");
const EARLIER = new Date("2026-10-20T08:00:00Z");

function order(overrides: Partial<OrderLifecycle> = {}): OrderLifecycle {
  return {
    status: "pending",
    paymentStatus: "unpaid",
    paymentMethod: "cod",
    paidAt: null,
    cancelledAt: null,
    refundedAt: null,
    shippedAt: null,
    completedAt: null,
    arrivedAt: null,
    waybillNumber: null,
    ...overrides,
  };
}

describe("canChangeOrderStatus", () => {
  const allowed: [OrderStatus, OrderStatus][] = [
    ["pending", "paid"],
    ["pending", "shipped"],
    ["pending", "cancelled"],
    ["paid", "shipped"],
    ["paid", "cancelled"],
    ["shipped", "completed"],
    ["shipped", "returned"],
    ["shipped", "unclaimed"],
    ["completed", "returned"],
  ];

  it("allows exactly the transitions of the lifecycle", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect([from, to, canChangeOrderStatus(from, to)]).toEqual([from, to, expected]);
      }
    }
  });
});

describe("canChangePaymentStatus", () => {
  it("only goes unpaid → paid → refunded", () => {
    const pairs = PAYMENT_STATUSES.flatMap((from) =>
      PAYMENT_STATUSES.filter((to) => canChangePaymentStatus(from, to)).map((to) => [from, to]),
    );
    expect(pairs).toEqual([
      ["unpaid", "paid"],
      ["paid", "refunded"],
    ]);
  });
});

describe("nextOrderState", () => {
  it("ships a cash-on-delivery order while its payment is still pending", () => {
    expect(nextOrderState(order(), { status: "shipped" }, NOW)).toEqual({
      ok: true,
      patch: { status: "shipped", shippedAt: NOW },
      restock: false,
    });
  });

  it("refuses to ship an unpaid card order", () => {
    expect(nextOrderState(order({ paymentMethod: "card" }), { status: "shipped" }, NOW)).toEqual({
      ok: false,
      error: "card-not-paid",
      from: "pending",
      to: "shipped",
    });
  });

  it("marks the payment paid when the order moves to paid", () => {
    expect(nextOrderState(order({ paymentMethod: "card" }), { status: "paid" }, NOW)).toEqual({
      ok: true,
      patch: { status: "paid", paymentStatus: "paid", paidAt: NOW },
      restock: false,
    });
  });

  it("moves a pending order to paid when its payment is marked paid", () => {
    expect(nextOrderState(order(), { paymentStatus: "paid" }, NOW)).toEqual({
      ok: true,
      patch: { status: "paid", paymentStatus: "paid", paidAt: NOW },
      restock: false,
    });
  });

  it("collects the cash when a cash-on-delivery order is completed", () => {
    const shipped = order({ status: "shipped", shippedAt: EARLIER });
    expect(nextOrderState(shipped, { status: "completed" }, NOW)).toEqual({
      ok: true,
      patch: { status: "completed", paymentStatus: "paid", paidAt: NOW, completedAt: NOW },
      restock: false,
    });
  });

  it("keeps an earlier paid_at", () => {
    const paid = order({
      status: "shipped",
      paymentMethod: "card",
      paymentStatus: "paid",
      paidAt: EARLIER,
    });
    expect(nextOrderState(paid, { status: "completed" }, NOW)).toEqual({
      ok: true,
      patch: { status: "completed", completedAt: NOW },
      restock: false,
    });
  });

  it("cancels with restock and refunds in one change", () => {
    const paid = order({ status: "paid", paymentStatus: "paid", paidAt: EARLIER });
    expect(nextOrderState(paid, { status: "cancelled", paymentStatus: "refunded" }, NOW)).toEqual({
      ok: true,
      patch: {
        status: "cancelled",
        paymentStatus: "refunded",
        refundedAt: NOW,
        cancelledAt: NOW,
      },
      restock: true,
    });
  });

  it("restocks an unclaimed parcel but not a returned one", () => {
    const shipped = order({ status: "shipped", shippedAt: EARLIER });
    expect(nextOrderState(shipped, { status: "unclaimed" }, NOW)).toMatchObject({
      ok: true,
      restock: true,
    });
    expect(nextOrderState(shipped, { status: "returned" }, NOW)).toMatchObject({
      ok: true,
      restock: false,
    });
  });

  it("rejects leaving a final status", () => {
    const cancelled = order({ status: "cancelled", cancelledAt: EARLIER });
    expect(nextOrderState(cancelled, { status: "shipped" }, NOW)).toEqual({
      ok: false,
      error: "invalid-transition",
      from: "cancelled",
      to: "shipped",
    });
  });

  it("rejects refunding an unpaid order", () => {
    expect(nextOrderState(order(), { paymentStatus: "refunded" }, NOW)).toEqual({
      ok: false,
      error: "invalid-payment-transition",
      from: "unpaid",
      to: "refunded",
    });
  });

  it("treats the current values as no change", () => {
    const cancelled = order({ status: "cancelled", cancelledAt: EARLIER });
    expect(
      nextOrderState(cancelled, { status: "cancelled", paymentStatus: "unpaid" }, NOW),
    ).toEqual({ ok: true, patch: {}, restock: false });
  });
});

describe("nextOrderState: arrival at the branch and the waybill (#138)", () => {
  const shipped = order({ status: "shipped", shippedAt: EARLIER });

  it("sets arrived_at once for a shipped order", () => {
    expect(nextOrderState(shipped, { arrivedAtBranch: true }, NOW)).toEqual({
      ok: true,
      patch: { arrivedAt: NOW },
      restock: false,
    });
    // Already arrived: no change, the first time stays.
    expect(
      nextOrderState({ ...shipped, arrivedAt: EARLIER }, { arrivedAtBranch: true }, NOW),
    ).toEqual({ ok: true, patch: {}, restock: false });
  });

  it("accepts the arrival in the same change that ships the order", () => {
    expect(
      nextOrderState(order({ status: "paid" }), { status: "shipped", arrivedAtBranch: true }, NOW),
    ).toMatchObject({ ok: true, patch: { status: "shipped", shippedAt: NOW, arrivedAt: NOW } });
  });

  it("refuses an arrival for an order that isn't shipped", () => {
    expect(nextOrderState(order(), { arrivedAtBranch: true }, NOW)).toEqual({
      ok: false,
      error: "arrived-not-shipped",
      status: "pending",
    });
    expect(nextOrderState(shipped, { status: "completed", arrivedAtBranch: true }, NOW)).toEqual({
      ok: false,
      error: "arrived-not-shipped",
      status: "completed",
    });
  });

  it("clears the arrival when it's unticked and ignores an untouched checkbox", () => {
    const arrived = { ...shipped, arrivedAt: EARLIER };
    expect(nextOrderState(arrived, { arrivedAtBranch: false }, NOW)).toEqual({
      ok: true,
      patch: { arrivedAt: null },
      restock: false,
    });
    expect(nextOrderState(arrived, { arrivedAtBranch: null }, NOW)).toEqual({
      ok: true,
      patch: {},
      restock: false,
    });
    expect(nextOrderState(shipped, { arrivedAtBranch: false }, NOW)).toEqual({
      ok: true,
      patch: {},
      restock: false,
    });
  });

  it("stores a changed waybill number at any status, and nothing when it's the same", () => {
    expect(nextOrderState(order(), { waybillNumber: "20450000000001" }, NOW)).toEqual({
      ok: true,
      patch: { waybillNumber: "20450000000001" },
      restock: false,
    });
    const withWaybill = { ...shipped, waybillNumber: "20450000000001" };
    expect(nextOrderState(withWaybill, { waybillNumber: "20450000000001" }, NOW)).toEqual({
      ok: true,
      patch: {},
      restock: false,
    });
    expect(nextOrderState(withWaybill, { waybillNumber: null }, NOW)).toEqual({
      ok: true,
      patch: { waybillNumber: null },
      restock: false,
    });
  });
});
