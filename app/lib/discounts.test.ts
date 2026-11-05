import { describe, expect, it } from "vitest";
import { discountLabel, normalizePromoCode } from "./discounts";
import { promoCodeSchema } from "./discounts.schema";
import { createTranslator } from "./i18n";

describe("promoCodeSchema", () => {
  it("trims and uppercases what the shopper typed", () => {
    expect(normalizePromoCode("  jassmin10 ")).toBe("JASSMIN10");
    expect(promoCodeSchema.parse(" welcome-10_x ")).toBe("WELCOME-10_X");
  });

  it("rejects empty, too long or odd codes with the promoInvalid key", () => {
    for (const code of ["", "   ", "A".repeat(41), "JASS MIN", "ЗНИЖКА", "10%"]) {
      const result = promoCodeSchema.safeParse(code);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("cart.errors.promoInvalid");
    }
    expect(promoCodeSchema.safeParse(undefined).error?.issues[0]?.message).toBe(
      "cart.errors.promoInvalid",
    );
  });
});

describe("discountLabel", () => {
  const en = createTranslator("en");

  it("names the tester trio and the couple offer (#124) in Ukrainian and English", () => {
    expect(discountLabel({ code: null, kind: "fixed_price_set" })).toBe("Тестерне тріо 3 × 10 мл");
    expect(discountLabel({ code: null, kind: "percent_every_nth" })).toBe(
      "Пропозиція для двох: −15% на другий флакон",
    );
    expect(discountLabel({ code: null, kind: "percent_every_nth" }, en)).toBe(
      "Couple offer: −15% on the second bottle",
    );
    expect(discountLabel({ code: null, kind: "percent" }, en)).toBe("Discount");
  });

  it("names the promo code whatever the rule's kind", () => {
    expect(discountLabel({ code: "PAIR", kind: "percent_every_nth" }, en)).toBe(
      "Discount (promo code PAIR)",
    );
  });
});
