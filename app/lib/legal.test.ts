import { describe, expect, it } from "vitest";
import {
  DELIVERY_UPDATED_AT,
  missingSellerDetails,
  OFFER_UPDATED_AT,
  RETURNS_UPDATED_AT,
  type SellerDetails,
} from "./legal";

const seller: SellerDetails = {
  legalName: "Іваненко Марія Петрівна",
  taxId: "1234567890",
  legalAddress: "м. Київ, вул. Хрещатик, 1",
  registrationNote: null,
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
};

describe("missingSellerDetails", () => {
  it("is empty when every required detail is filled; the registration note is optional", () => {
    expect(missingSellerDetails(seller)).toEqual([]);
  });

  it("lists empty and blank required details in order", () => {
    expect(
      missingSellerDetails({ ...seller, legalAddress: " ", taxId: null, legalName: "" }),
    ).toEqual(["legalName", "taxId", "legalAddress"]);
  });
});

describe("version dates", () => {
  it("are ISO dates", () => {
    for (const date of [OFFER_UPDATED_AT, RETURNS_UPDATED_AT, DELIVERY_UPDATED_AT]) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(date).toISOString().slice(0, 10)).toBe(date);
    }
  });
});
