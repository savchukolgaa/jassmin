import { describe, expect, it } from "vitest";
import {
  CART_STATUSES,
  GENDERS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  USER_ROLES,
} from "./enums";

describe("enum values", () => {
  it("lists the genders", () => {
    expect(GENDERS).toEqual(["women", "men", "unisex"]);
  });

  it("lists the order statuses", () => {
    expect(ORDER_STATUSES).toEqual([
      "pending",
      "paid",
      "shipped",
      "completed",
      "cancelled",
      "returned",
      "unclaimed",
    ]);
  });

  it("lists the payment statuses", () => {
    expect(PAYMENT_STATUSES).toEqual(["unpaid", "paid", "refunded"]);
  });

  it("lists the cart statuses", () => {
    expect(CART_STATUSES).toEqual(["active", "converted", "abandoned"]);
  });

  it("lists the payment methods", () => {
    expect(PAYMENT_METHODS).toEqual(["card", "cod"]);
  });

  it("lists the user roles", () => {
    expect(USER_ROLES).toEqual(["customer", "admin"]);
  });
});
