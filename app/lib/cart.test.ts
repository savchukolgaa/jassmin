import { describe, expect, it } from "vitest";
import { cartErrorMessage as cartErrorMessage_ } from "./cart";
import { parseCartAction } from "./cart.schema";
import { createTranslator } from "./i18n";

const en = createTranslator("en");
const cartErrorMessage = (result: Parameters<typeof cartErrorMessage_>[0]) =>
  cartErrorMessage_(result, en);

const form = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
};

const PRODUCT_ID = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";
const VARIANT_ID = "01a1652b-6e25-7d00-8000-000000000001";

describe("parseCartAction", () => {
  const add = { intent: "add", productId: PRODUCT_ID, variantId: VARIANT_ID };

  it("accepts an add intent with a product's and a variant's public id, one unit by default", () => {
    expect(parseCartAction(form(add)).data).toEqual({ ...add, quantity: 1 });
    expect(parseCartAction(form({ ...add, quantity: "3" })).data).toEqual({ ...add, quantity: 3 });
  });

  it("rejects an add with invalid product or variant ids", () => {
    expect(parseCartAction(form({ ...add, productId: "42" })).success).toBe(false);
    expect(parseCartAction(form({ ...add, variantId: "42" })).success).toBe(false);
    expect(parseCartAction(form({ intent: "add", productId: PRODUCT_ID })).success).toBe(false);
  });

  it("accepts an update with a whole quantity from 1 to 99", () => {
    const update = { intent: "update", variantId: VARIANT_ID };

    expect(parseCartAction(form({ ...update, quantity: "2" })).data).toEqual({
      ...update,
      quantity: 2,
    });
    expect(parseCartAction(form({ ...update, quantity: "99" })).success).toBe(true);
    for (const quantity of ["0", "-1", "100", "1.5", "two", ""]) {
      expect(parseCartAction(form({ ...update, quantity })).success).toBe(false);
    }
    expect(parseCartAction(form(update)).success).toBe(false);
  });

  it("accepts a remove with a variant id", () => {
    expect(parseCartAction(form({ intent: "remove", variantId: VARIANT_ID })).data).toEqual({
      intent: "remove",
      variantId: VARIANT_ID,
    });
    expect(parseCartAction(form({ intent: "remove", variantId: "1" })).success).toBe(false);
  });

  it("rejects unknown or missing intents", () => {
    expect(parseCartAction(form({ ...add, intent: "clear" })).success).toBe(false);
    expect(parseCartAction(form({})).success).toBe(false);
  });
});

describe("cartErrorMessage in Ukrainian", () => {
  it("is the default", () => {
    expect(cartErrorMessage_({ error: "exceeds-stock", available: 3 })).toBe(
      "Цього об’єму доступно лише 3 шт.",
    );
  });
});

describe("cartErrorMessage", () => {
  it("names the stock left when a line would exceed it", () => {
    expect(cartErrorMessage({ error: "exceeds-stock", available: 3 })).toBe(
      "Only 3 available in this volume.",
    );
    expect(cartErrorMessage({ error: "exceeds-stock", available: 0 })).toBe(
      "This volume is out of stock.",
    );
    expect(cartErrorMessage({ error: "exceeds-stock" })).toBe(
      "There isn't enough of this volume in stock.",
    );
  });

  it("uses the fixed message for other errors", () => {
    expect(cartErrorMessage({ error: "not-in-cart" })).toBe(
      "This perfume is no longer in your cart.",
    );
  });
});
