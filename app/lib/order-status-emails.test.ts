import { describe, expect, it } from "vitest";
import { ORDER_EMAIL_TYPES } from "./enums";
import { nextOrderState, type OrderLifecycle, type OrderStatusChange } from "./order-status";
import {
  isOrderStatusEmailType,
  ORDER_STATUS_EMAIL_TYPES,
  orderStatusEmailTypes,
} from "./order-status-emails";

const NOW = new Date("2026-11-06T12:00:00Z");
const EARLIER = new Date("2026-11-01T08:00:00Z");

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

/** The emails a change of `before` would queue. */
function emailsFor(before: OrderLifecycle, change: OrderStatusChange) {
  const next = nextOrderState(before, change, NOW);
  if (!next.ok) throw new Error(`refused: ${next.error}`);
  return orderStatusEmailTypes(next.patch);
}

const paidCard = order({ status: "paid", paymentStatus: "paid", paymentMethod: "card" });
const shipped = order({ status: "shipped", shippedAt: EARLIER });

describe("orderStatusEmailTypes", () => {
  it("are order email types", () => {
    for (const type of ORDER_STATUS_EMAIL_TYPES) {
      expect(ORDER_EMAIL_TYPES).toContain(type);
    }
    expect(ORDER_EMAIL_TYPES.filter(isOrderStatusEmailType)).toEqual([
      "shipped",
      "arrived",
      "cancelled",
      "refunded",
    ]);
  });

  it("sends shipped when an order ships, cash on delivery or paid", () => {
    expect(emailsFor(order(), { status: "shipped" })).toEqual(["shipped"]);
    expect(emailsFor(paidCard, { status: "shipped", waybillNumber: "20450000000001" })).toEqual([
      "shipped",
    ]);
  });

  it("sends arrived when the parcel reaches the branch", () => {
    expect(emailsFor(shipped, { arrivedAtBranch: true })).toEqual(["arrived"]);
    expect(emailsFor(paidCard, { status: "shipped", arrivedAtBranch: true })).toEqual([
      "shipped",
      "arrived",
    ]);
  });

  it("sends cancelled, and refunded too when the money goes back in the same change", () => {
    expect(emailsFor(order(), { status: "cancelled" })).toEqual(["cancelled"]);
    expect(emailsFor(paidCard, { status: "cancelled", paymentStatus: "refunded" })).toEqual([
      "cancelled",
      "refunded",
    ]);
    expect(
      emailsFor(order({ status: "cancelled", paymentStatus: "paid" }), {
        paymentStatus: "refunded",
      }),
    ).toEqual(["refunded"]);
  });

  it("sends nothing for other statuses and unrelated edits", () => {
    expect(emailsFor(order(), { status: "paid" })).toEqual([]);
    expect(emailsFor(order(), { paymentStatus: "paid" })).toEqual([]);
    expect(emailsFor(shipped, { status: "completed" })).toEqual([]);
    expect(emailsFor(shipped, { status: "unclaimed" })).toEqual([]);
    expect(emailsFor(order({ status: "completed" }), { status: "returned" })).toEqual([]);
    expect(emailsFor(shipped, { waybillNumber: "20450000000001" })).toEqual([]);
    expect(emailsFor(shipped, { status: "shipped" })).toEqual([]);
    expect(emailsFor(shipped, {})).toEqual([]);
    // Unticking the arrival clears it but sends nothing.
    expect(emailsFor({ ...shipped, arrivedAt: EARLIER }, { arrivedAtBranch: false })).toEqual([]);
  });
});
