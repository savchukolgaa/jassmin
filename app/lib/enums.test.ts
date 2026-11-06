import { describe, expect, it } from "vitest";
import {
  AUTH_TOKEN_PURPOSES,
  CANCEL_REASONS,
  CART_STATUSES,
  EVENT_TYPES,
  GENDERS,
  ORDER_STATUS_SOURCES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PERFUME_VOLUMES_ML,
  USER_ROLES,
} from "./enums";

describe("enum values", () => {
  it("lists the auth token purposes", () => {
    expect(AUTH_TOKEN_PURPOSES).toEqual(["password_reset", "email_verification"]);
  });

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

  it("lists the cancel reasons", () => {
    expect(CANCEL_REASONS).toEqual([
      "customer_request",
      "out_of_stock",
      "no_answer",
      "payment_failed",
      "other",
    ]);
  });

  it("lists the order status sources", () => {
    expect(ORDER_STATUS_SOURCES).toEqual(["checkout", "payment", "cms", "job"]);
  });

  it("lists the payment statuses", () => {
    expect(PAYMENT_STATUSES).toEqual(["unpaid", "paid", "refunded"]);
  });

  it("lists the cart statuses", () => {
    expect(CART_STATUSES).toEqual(["active", "converted", "abandoned"]);
  });

  it("lists the payment methods", () => {
    expect(PAYMENT_METHODS).toEqual(["card", "cod", "gift_card"]);
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

  it("lists the perfume volumes in ascending order", () => {
    expect(PERFUME_VOLUMES_ML).toEqual([5, 10, 30, 50, 100]);
  });

  it("lists the user roles", () => {
    expect(USER_ROLES).toEqual(["customer", "admin"]);
  });
});
