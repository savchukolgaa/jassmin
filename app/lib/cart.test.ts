import { describe, expect, it } from "vitest";
import { parseAddToCart } from "./cart";

const form = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
};

const PRODUCT_ID = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";

describe("parseAddToCart", () => {
  it("accepts an add intent with a product's public id", () => {
    expect(parseAddToCart(form({ intent: "add", productId: PRODUCT_ID })).data).toEqual({
      intent: "add",
      productId: PRODUCT_ID,
    });
  });

  it("rejects other intents and invalid product ids", () => {
    expect(parseAddToCart(form({ intent: "remove", productId: PRODUCT_ID })).success).toBe(false);
    expect(parseAddToCart(form({ intent: "add", productId: "42" })).success).toBe(false);
    expect(parseAddToCart(form({})).success).toBe(false);
  });
});
