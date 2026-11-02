import { describe, expect, it } from "vitest";
import { normalizePromoCode } from "./discounts";
import { promoCodeSchema } from "./discounts.schema";

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
