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

/** The couple offer (#124): 15% off every second single full bottle, dearest first. */
const COUPLE = rule({
  id: 30,
  kind: "percent_every_nth",
  value: "15.00",
  scopeVolumesMl: [30, 50, 100],
  scopePackSize: 1,
  minQuantity: 2,
});

/** A full bottle at `unitPrice` kopiyky. */
function bottle(unitPrice: number, overrides: Partial<PricingLine> = {}): PricingLine {
  return line({ volumeMl: 50, unitPrice, productPublicId: `p-${unitPrice}`, ...overrides });
}

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

  describe("couple offer", () => {
    it("needs two full bottles", () => {
      expect(discountSaving([], COUPLE)).toBe(0);
      expect(discountSaving([bottle(200_000)], COUPLE)).toBe(0);
    });

    it("takes 15% off the cheaper of two bottles", () => {
      // 2000 ₴ + 1500 ₴: 15% of 1500 ₴ = 225 ₴.
      expect(discountSaving([bottle(200_000), bottle(150_000)], COUPLE)).toBe(22_500);
      // The order of the lines doesn't matter.
      expect(discountSaving([bottle(150_000), bottle(200_000)], COUPLE)).toBe(22_500);
      // Two of the same bottle on one line.
      expect(discountSaving([bottle(189_000, { quantity: 2 })], COUPLE)).toBe(28_350);
    });

    it("discounts one of three bottles and two of four, the cheaper of each pair", () => {
      // 3000, 2000, 1000 ₴: pairs (3000, 2000) and a lone 1000 → 15% of 2000 ₴.
      expect(discountSaving([bottle(100_000), bottle(300_000), bottle(200_000)], COUPLE)).toBe(
        30_000,
      );
      // 4000, 3000, 2000, 1000 ₴: 15% of 3000 + 1000 ₴.
      expect(
        discountSaving(
          [bottle(100_000), bottle(400_000), bottle(200_000), bottle(300_000)],
          COUPLE,
        ),
      ).toBe(60_000);
    });

    it("rounds down to the kopiyka", () => {
      // 15% of 999.99 ₴ is 149.9985 ₴: the shopper gets 149.99 ₴.
      expect(discountSaving([bottle(99_999, { quantity: 2 })], COUPLE)).toBe(14_999);
    });

    it("never counts 5 and 10 ml sizes or sets", () => {
      const tenMl = line({ volumeMl: 10, unitPrice: 79_000, quantity: 4 });
      const fiveMl = line({ volumeMl: 5, unitPrice: 45_000, quantity: 2 });
      expect(discountSaving([tenMl, fiveMl], COUPLE)).toBe(0);
      // One full bottle and a 10 ml size aren't a pair.
      expect(discountSaving([bottle(200_000), tenMl], COUPLE)).toBe(0);
      expect(discountSaving([bottle(200_000, { packSize: 2 }), bottle(150_000)], COUPLE)).toBe(0);
      // Only the full bottles count when both are in the cart.
      expect(discountSaving([bottle(200_000), bottle(150_000), tenMl], COUPLE)).toBe(22_500);
    });

    it("discounts at most max_sets pairs", () => {
      const onePair = rule({ ...COUPLE, maxSets: 1 });
      expect(discountSaving([bottle(100_000, { quantity: 4 })], onePair)).toBe(15_000);
    });
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

  it("applies the couple offer by itself to two full bottles", () => {
    const priced = priceCart([bottle(200_000), bottle(150_000)], [TRIO, COUPLE], NOW);
    expect(priced).toMatchObject({
      subtotal: 350_000,
      discount: 22_500,
      total: 327_500,
      applied: { discountId: 30, code: null, kind: "percent_every_nth", amount: 22_500 },
    });
  });

  it("picks whichever of the trio and the couple offer saves more", () => {
    const trio = line({ quantity: 3 });
    // The trio saves 1871 ₴; 15% of a 1500 ₴ bottle is 225 ₴.
    expect(
      priceCart([trio, bottle(200_000), bottle(150_000)], [TRIO, COUPLE], NOW).applied?.kind,
    ).toBe("fixed_price_set");
    // Three cheap testers save 0; the pair still saves.
    const cheapTrio = line({ quantity: 3, unitPrice: 10_000 });
    expect(
      priceCart([cheapTrio, bottle(200_000), bottle(150_000)], [TRIO, COUPLE], NOW).applied?.kind,
    ).toBe("percent_every_nth");
  });

  it("uses a promo code that saves more than the couple offer, else keeps it as not-best", () => {
    const pair = [bottle(200_000), bottle(150_000)];
    // 10% of 3500 ₴ = 350 ₴ beats 15% of 1500 ₴ = 225 ₴.
    expect(priceCart(pair, [COUPLE, TEN_PERCENT_CODE], NOW)).toMatchObject({
      discount: 35_000,
      applied: { discountId: 20 },
      promo: { status: "applied" },
    });
    // 100 ₴ off loses to 225 ₴.
    const hundred = rule({ id: 21, kind: "fixed_amount", value: "100.00", code: "HUNDRED" });
    expect(priceCart(pair, [COUPLE, hundred], NOW)).toMatchObject({
      discount: 22_500,
      applied: { discountId: 30 },
      promo: { code: "HUNDRED", status: "not-best" },
    });
  });

  it("decides free delivery after the couple offer", () => {
    // 900 + 700 ₴ = 1600 ₴, minus 15% of 700 ₴ = 1495 ₴: below the 1500 ₴ threshold.
    const priced = priceCart([bottle(90_000), bottle(70_000)], [COUPLE], NOW);
    expect(priced).toMatchObject({ discount: 10_500, freeShipping: false });
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

  it("gives free delivery from 1500 ₴", () => {
    expect(priceCart([line({ unitPrice: 149_999 })], [], NOW).freeShipping).toBe(false);
    expect(priceCart([line({ unitPrice: 150_000 })], [], NOW).freeShipping).toBe(true);
  });

  it("decides free delivery on the discounted subtotal", () => {
    // 1600 ₴ − 10% = 1440 ₴, below the 1500 ₴ threshold.
    const lines = [line({ unitPrice: 160_000 })];
    expect(priceCart(lines, [], NOW).freeShipping).toBe(true);
    expect(priceCart(lines, [TEN_PERCENT_CODE], NOW)).toMatchObject({
      total: 144_000,
      shipping: 0,
      freeShipping: false,
    });
    // 1666.66 ₴ − 166.66 ₴ is exactly 1500 ₴ after the discount, which is free.
    expect(priceCart([line({ unitPrice: 166_666 })], [TEN_PERCENT_CODE], NOW)).toMatchObject({
      total: 150_000,
      freeShipping: true,
    });
  });
});
