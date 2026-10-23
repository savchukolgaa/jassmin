import { describe, expect, it } from "vitest";
import { parseAddToCart } from "./cart";

const form = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
};

const PRODUCT_ID = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";
const VARIANT_ID = "01a1652b-6e25-7d00-8000-000000000001";

describe("parseAddToCart", () => {
  const valid = { intent: "add", productId: PRODUCT_ID, variantId: VARIANT_ID };

  it("accepts an add intent with a product's and a variant's public id", () => {
    expect(parseAddToCart(form(valid)).data).toEqual(valid);
  });

  it("rejects other intents and invalid product or variant ids", () => {
    expect(parseAddToCart(form({ ...valid, intent: "remove" })).success).toBe(false);
    expect(parseAddToCart(form({ ...valid, productId: "42" })).success).toBe(false);
    expect(parseAddToCart(form({ ...valid, variantId: "42" })).success).toBe(false);
    expect(parseAddToCart(form({ intent: "add", productId: PRODUCT_ID })).success).toBe(false);
    expect(parseAddToCart(form({})).success).toBe(false);
  });
});
