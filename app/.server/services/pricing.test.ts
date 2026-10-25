import { describe, expect, it } from "vitest";
import {
  discountAvailability,
  discountSaving,
  type PricingDiscount,
  type PricingLine,
  priceCart,
} from "./pricing";

const NOW = new Date("2026-10-25T12:00:00Z");

function line(overrides: Partial<PricingLine> = {}): PricingLine {
  return {
    productPublicId: "01a1652b-6e25-7c44-8d5b-bce46a20ad83",
    volumeMl: 10,
    packSize: 1,
    unitPrice: 79_000,
    quantity: 1,
    ...overrides,
  };
}

function rule(overrides: Partial<PricingDiscount> = {}): PricingDiscount {
  return {
    id: 1,
    code: null,
    kind: "percent",
    value: "10.00",
    scopeVolumesMl: null,
    scopeProductPublicIds: null,
    scopePackSize: null,
    minQuantity: 1,
    maxSets: null,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    active: true,
    ...overrides,
  };
}

/** The seeded tester trio: any three single 10 ml units for 499 ₴, at most three sets. */
const TRIO = rule({
  id: 10,
  kind: "fixed_price_set",
  value: "499.00",
  scopeVolumesMl: [10],
  scopePackSize: 1,
  minQuantity: 3,
  maxSets: 3,
});

const TEN_PERCENT_CODE = rule({ id: 20, code: "JASSMIN10" });

describe("discountSaving", () => {
  it("takes a percentage of the qualifying lines, rounded down to the kopiyka", () => {
    expect(discountSaving([line({ unitPrice: 79_000, quantity: 2 })], rule())).toBe(15_800);
    // 10% of 999.99 ₴ is 99.999 ₴: the shopper gets 99.99 ₴.
    expect(discountSaving([line({ unitPrice: 99_999 })], rule())).toBe(9_999);
    expect(discountSaving([line({ unitPrice: 10_000 })], rule({ value: "12.50" }))).toBe(1_250);
  });

  it("takes a fixed amount, never more than the qualifying lines cost", () => {
    const hundredOff = rule({ kind: "fixed_amount", value: "100.00" });
    expect(discountSaving([line({ unitPrice: 79_000 })], hundredOff)).toBe(10_000);
    expect(discountSaving([line({ unitPrice: 5_000 })], hundredOff)).toBe(5_000);
  });

  it("prices each set of the trio at 499 ₴ with the dearest units first, up to three sets", () => {
    const sauvage = line({ unitPrice: 79_000 });
    const bleu = line({ unitPrice: 109_000, productPublicId: "bleu" });

    expect(discountSaving([line({ quantity: 2 })], TRIO)).toBe(0);
    // 3 × 790 = 2370 ₴ → 499 ₴.
    expect(discountSaving([line({ quantity: 3 })], TRIO)).toBe(237_000 - 49_900);
    // Two sets from six units.
    expect(discountSaving([line({ quantity: 6 })], TRIO)).toBe(6 * 79_000 - 2 * 49_900);
    // Ten units: three sets (the cap); the tenth unit stays at full price.
    expect(discountSaving([line({ quantity: 10 })], TRIO)).toBe(9 * 79_000 - 3 * 49_900);
    // Four units, one dearer: the set takes the 1090 ₴ unit and two 790 ₴ ones.
    expect(discountSaving([{ ...sauvage, quantity: 3 }, bleu], TRIO)).toBe(
      109_000 + 2 * 79_000 - 49_900,
    );
  });

  it("only counts units in the rule's scope", () => {
    const thirty = line({ volumeMl: 30, unitPrice: 189_000, quantity: 3 });
    const testerSet = line({ volumeMl: 10, packSize: 3, unitPrice: 99_000, quantity: 3 });
    expect(discountSaving([thirty], TRIO)).toBe(0);
    // The 3 × 10 ml set product isn't three single 10 ml units.
    expect(discountSaving([testerSet], TRIO)).toBe(0);
    // Two single 10 ml plus out-of-scope lines don't make a set.
    expect(discountSaving([line({ quantity: 2 }), thirty, testerSet], TRIO)).toBe(0);

    const sauvageOnly = rule({ scopeProductPublicIds: ["sauvage"] });
    expect(
      discountSaving(
        [line({ productPublicId: "sauvage" }), line({ productPublicId: "other" })],
        sauvageOnly,
      ),
    ).toBe(7_900);
  });

  it("needs min_quantity qualifying units", () => {
    const twoOrMore = rule({ minQuantity: 2 });
    expect(discountSaving([line()], twoOrMore)).toBe(0);
    expect(discountSaving([line({ quantity: 2 })], twoOrMore)).toBe(15_800);
    expect(discountSaving([line(), line({ productPublicId: "other" })], twoOrMore)).toBe(15_800);
  });

  it("never saves less than nothing", () => {
    // Three cheap units cost less than the set price.
    expect(discountSaving([line({ unitPrice: 10_000, quantity: 3 })], TRIO)).toBe(0);
  });
});

describe("discountAvailability", () => {
  it("starts inclusive and ends exclusive", () => {
    expect(discountAvailability(rule({ startsAt: NOW }), NOW)).toBe("available");
    expect(discountAvailability(rule({ startsAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      "invalid",
    );
    expect(discountAvailability(rule({ endsAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      "available",
    );
    expect(discountAvailability(rule({ endsAt: NOW }), NOW)).toBe("expired");
  });

  it("reports inactive and used-up rules", () => {
    expect(discountAvailability(rule({ active: false }), NOW)).toBe("invalid");
    expect(discountAvailability(rule({ maxRedemptions: 5, redemptionCount: 4 }), NOW)).toBe(
      "available",
    );
    expect(discountAvailability(rule({ maxRedemptions: 5, redemptionCount: 5 }), NOW)).toBe(
      "used-up",
    );
  });
});

describe("priceCart", () => {
  it("charges the subtotal when nothing applies", () => {
    expect(
      priceCart([line({ volumeMl: 30, unitPrice: 189_000, quantity: 2 })], [TRIO], NOW),
    ).toEqual({
      subtotal: 378_000,
      discount: 0,
      shipping: 0,
      total: 378_000,
      freeShipping: true,
      applied: null,
      promo: null,
    });
  });

  it("applies the trio by itself when the cart qualifies", () => {
    const priced = priceCart([line({ quantity: 3 })], [TRIO], NOW);
    expect(priced).toMatchObject({
      subtotal: 237_000,
      discount: 187_100,
      total: 49_900,
      applied: { discountId: 10, code: null, kind: "fixed_price_set", amount: 187_100 },
    });
  });

  it("applies an entered code and reports it", () => {
    const priced = priceCart(
      [line({ volumeMl: 30, unitPrice: 189_000 })],
      [TRIO, TEN_PERCENT_CODE],
      NOW,
    );
    expect(priced).toMatchObject({
      discount: 18_900,
      total: 170_100,
      applied: { discountId: 20, code: "JASSMIN10" },
      promo: { discountId: 20, code: "JASSMIN10", status: "applied" },
    });
  });

  it("uses only the best rule and keeps a weaker code as not-best", () => {
    const priced = priceCart([line({ quantity: 3 })], [TEN_PERCENT_CODE, TRIO], NOW);
    expect(priced.applied?.discountId).toBe(10);
    expect(priced.discount).toBe(187_100);
    expect(priced.promo).toEqual({ discountId: 20, code: "JASSMIN10", status: "not-best" });
  });

  it("prefers the entered code, then the older rule, on equal savings", () => {
    const lines = [line({ unitPrice: 100_000 })];
    const auto = rule({ id: 1, kind: "fixed_amount", value: "100.00" });
    const code = rule({ id: 2, kind: "fixed_amount", value: "100.00", code: "HUNDRED" });
    expect(priceCart(lines, [auto, code], NOW).applied?.discountId).toBe(2);
    expect(priceCart(lines, [rule({ ...auto, id: 3 }), auto], NOW).applied?.discountId).toBe(1);
  });

  it("says why a code isn't used, without changing the total", () => {
    const lines = [line({ unitPrice: 100_000 })];
    const cases = [
      [rule({ ...TEN_PERCENT_CODE, endsAt: NOW }), "expired"],
      [rule({ ...TEN_PERCENT_CODE, maxRedemptions: 1, redemptionCount: 1 }), "used-up"],
      [rule({ ...TEN_PERCENT_CODE, active: false }), "invalid"],
      [rule({ ...TEN_PERCENT_CODE, scopeVolumesMl: [50] }), "not-applicable"],
    ] as const;
    for (const [code, status] of cases) {
      const priced = priceCart(lines, [code], NOW);
      expect(priced.promo?.status).toBe(status);
      expect(priced.total).toBe(100_000);
      expect(priced.applied).toBeNull();
    }
  });

  it("never lets the total go below zero", () => {
    const priced = priceCart(
      [line({ unitPrice: 5_000 })],
      [rule({ kind: "fixed_amount", value: "9999.00" })],
      NOW,
    );
    expect(priced.discount).toBe(5_000);
    expect(priced.total).toBe(0);
  });

  it("decides free delivery on the discounted subtotal", () => {
    // 1100 ₴ − 10% = 990 ₴, below the 1000 ₴ threshold.
    const lines = [line({ unitPrice: 110_000 })];
    expect(priceCart(lines, [], NOW).freeShipping).toBe(true);
    expect(priceCart(lines, [TEN_PERCENT_CODE], NOW)).toMatchObject({
      total: 99_000,
      shipping: 0,
      freeShipping: false,
    });
    // Exactly 1000 ₴ after the discount is free.
    expect(priceCart([line({ unitPrice: 111_111 })], [TEN_PERCENT_CODE], NOW).freeShipping).toBe(
      true,
    );
  });
});
