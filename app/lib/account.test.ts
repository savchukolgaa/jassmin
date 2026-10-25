import { describe, expect, it } from "vitest";
import {
  CURRENT_ORDER_STATUSES,
  firstName,
  isCurrentOrder,
  ORDER_PROGRESS_STEPS,
  orderProgressIndex,
  PREVIOUS_ORDER_STATUSES,
} from "./account";
import { ORDER_STATUSES } from "./enums";

describe("order status groups", () => {
  it("puts every status in exactly one group", () => {
    const grouped = [...CURRENT_ORDER_STATUSES, ...PREVIOUS_ORDER_STATUSES];
    expect([...grouped].sort()).toEqual([...ORDER_STATUSES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("splits current and previous orders by status", () => {
    expect(ORDER_STATUSES.filter(isCurrentOrder)).toEqual(["pending", "paid", "shipped"]);
  });
});

describe("orderProgressIndex", () => {
  it("places statuses on the pending → paid → shipped → completed path", () => {
    expect(ORDER_PROGRESS_STEPS.map(orderProgressIndex)).toEqual([0, 1, 2, 3]);
  });

  it("answers -1 for statuses off the path", () => {
    expect(orderProgressIndex("cancelled")).toBe(-1);
    expect(orderProgressIndex("returned")).toBe(-1);
    expect(orderProgressIndex("unclaimed")).toBe(-1);
  });
});

describe("firstName", () => {
  it("takes the first word of the full name", () => {
    expect(firstName("Олена Коваль")).toBe("Олена");
    expect(firstName("  Ann   Lee ")).toBe("Ann");
    expect(firstName("Madonna")).toBe("Madonna");
  });
});
