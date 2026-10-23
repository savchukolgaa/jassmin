import { describe, expect, it } from "vitest";
import {
  CART_STATUSES,
  EVENT_TYPES,
  GENDERS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
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

  it("lists the event types", () => {
    expect(EVENT_TYPES).toEqual([
      "page_view",
      "product_view",
      "search",
      "add_to_cart",
      "remove_from_cart",
      "checkout_start",
      "purchase",
      "login",
      "review_submit",
    ]);
  });
});
