import { describe, expect, it } from "vitest";
import { toFieldErrors } from "./auth";
import {
  CHECKOUT_FIELDS,
  checkoutValues,
  formatShippingAddress,
  freeShippingInfo,
  normalizeUkrainianPhone,
  parseCheckout,
  parseOrderId,
} from "./checkout";

const form = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
};

const valid = {
  fullName: "  Олена Коваль ",
  email: " Olena@Example.com ",
  phone: "+380 67 123 45 67",
  city: "Київ",
  branch: "Відділення №12",
  paymentMethod: "cod",
};

const fieldErrors = (fields: Record<string, string>) => {
  const result = parseCheckout(form(fields));
  if (result.success) throw new Error("Expected the form to be rejected");
  return toFieldErrors(result.error, CHECKOUT_FIELDS);
};

describe("normalizeUkrainianPhone", () => {
  it.each([
    "+380671234567",
    "+380 67 123 45 67",
    "380671234567",
    "0671234567",
    "(067) 123-45-67",
    "+38 (067) 123 45 67",
  ])("normalises %s to +380671234567", (raw) => {
    expect(normalizeUkrainianPhone(raw)).toBe("+380671234567");
  });

  it.each([
    "",
    "671234567",
    "+067 123 45 67",
    "+7 912 345 67 89",
    "+38067123456",
    "+3806712345678",
    "067 123 45 6x",
  ])("rejects %j", (raw) => {
    expect(normalizeUkrainianPhone(raw)).toBeUndefined();
  });
});

describe("parseCheckout", () => {
  it("trims, lowercases the email and normalises the phone", () => {
    expect(parseCheckout(form(valid)).data).toEqual({
      fullName: "Олена Коваль",
      email: "olena@example.com",
      phone: "+380671234567",
      city: "Київ",
      branch: "Відділення №12",
      paymentMethod: "cod",
    });
    expect(parseCheckout(form({ ...valid, paymentMethod: "card" })).success).toBe(true);
  });

  it("returns a message key per invalid field", () => {
    expect(
      fieldErrors({ fullName: " ", email: "nope", phone: "12345", city: "", branch: "" }),
    ).toEqual({
      fullName: "checkout.errors.fullNameRequired",
      email: "auth.errors.emailInvalid",
      phone: "checkout.errors.phoneInvalid",
      city: "checkout.errors.cityRequired",
      branch: "checkout.errors.branchRequired",
      paymentMethod: "checkout.errors.paymentRequired",
    });
  });

  it("rejects missing fields, an unknown payment method and overlong values", () => {
    expect(fieldErrors({ ...valid, paymentMethod: "crypto" })).toEqual({
      paymentMethod: "checkout.errors.paymentRequired",
    });
    expect(fieldErrors({ email: valid.email })).toMatchObject({
      fullName: "checkout.errors.fullNameRequired",
      phone: "checkout.errors.phoneInvalid",
      city: "checkout.errors.cityRequired",
    });
    expect(fieldErrors({ ...valid, city: "К".repeat(101), branch: "В".repeat(256) })).toEqual({
      city: "checkout.errors.cityTooLong",
      branch: "checkout.errors.branchTooLong",
    });
  });
});

describe("checkoutValues", () => {
  it("keeps the submitted form fields only", () => {
    expect(checkoutValues(form({ ...valid, intent: "x" }))).toEqual(valid);
  });
});

describe("formatShippingAddress", () => {
  it("joins the city and the branch", () => {
    expect(formatShippingAddress({ city: "Львів", branch: "Поштомат №3045" })).toBe(
      "Львів, Поштомат №3045",
    );
  });
});

describe("freeShippingInfo", () => {
  it("is free from 1000 UAH", () => {
    expect(freeShippingInfo("1000.00")).toEqual({ free: true });
    expect(freeShippingInfo("1500.5")).toEqual({ free: true });
  });

  it("says exactly how much is missing below 1000 UAH", () => {
    expect(freeShippingInfo("999.99")).toEqual({ free: false, remaining: "0.01" });
    expect(freeShippingInfo("750.00")).toEqual({ free: false, remaining: "250.00" });
    expect(freeShippingInfo("0.00")).toEqual({ free: false, remaining: "1000.00" });
  });
});

describe("parseOrderId", () => {
  it("accepts positive integer ids up to PostgreSQL's integer limit", () => {
    expect(parseOrderId("1")).toBe(1);
    expect(parseOrderId("42")).toBe(42);
    expect(parseOrderId("2147483647")).toBe(2_147_483_647);
  });

  it("rejects ids that can't be an order's", () => {
    for (const id of [undefined, "", "0", "-1", "abc", "1.5", "1e3", "2147483648", "99999999999"]) {
      expect(parseOrderId(id)).toBeNull();
    }
  });
});
