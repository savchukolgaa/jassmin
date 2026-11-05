import { describe, expect, it } from "vitest";
import {
  formatGiftCardCode,
  GIFT_CARD_AMOUNTS,
  GIFT_CARD_CODE_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  isGiftCardAmount,
  maskGiftCardCode,
  normalizeGiftCardCode,
  parseGiftCardId,
} from "./gift-cards";

describe("gift card amounts", () => {
  it("are 500, 1000 and 2000 hryvnias only", () => {
    expect(GIFT_CARD_AMOUNTS).toEqual([500, 1000, 2000]);
    expect(isGiftCardAmount(1000)).toBe(true);
    expect(isGiftCardAmount(750)).toBe(false);
  });
});

describe("gift card codes", () => {
  it("use 32 symbols without look-alikes, 16 of them", () => {
    expect(new Set(GIFT_CARD_CODE_ALPHABET).size).toBe(32);
    expect(GIFT_CARD_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(GIFT_CARD_CODE_LENGTH).toBe(16);
  });

  it("are shown in groups of four and read back however they were typed", () => {
    const code = "AB12CD34EF56GH78";
    expect(formatGiftCardCode(code)).toBe("AB12-CD34-EF56-GH78");
    expect(normalizeGiftCardCode("ab12-cd34-ef56-gh78")).toBe(code);
    expect(normalizeGiftCardCode("  AB12 CD34\tEF56 GH78 ")).toBe(code);
    expect(normalizeGiftCardCode(formatGiftCardCode(code))).toBe(code);
  });

  it("read the look-alikes O, I and L as 0 and 1", () => {
    expect(normalizeGiftCardCode("OOOO-IIII-LLLL-0000")).toBe("0000111111110000");
  });

  it("refuse input that can't be a code", () => {
    expect(normalizeGiftCardCode("")).toBeNull();
    expect(normalizeGiftCardCode("AB12-CD34-EF56")).toBeNull();
    expect(normalizeGiftCardCode("AB12-CD34-EF56-GH78-9")).toBeNull();
    expect(normalizeGiftCardCode("AB12-CD34-EF56-GH7U")).toBeNull();
    expect(normalizeGiftCardCode("AB12-CD34-EF56-GH7!")).toBeNull();
  });

  it("are masked down to the last four symbols", () => {
    expect(maskGiftCardCode("AB12CD34EF56GH78")).toBe("••••-••••-••••-GH78");
  });
});

describe("parseGiftCardId", () => {
  it("takes positive integer ids only", () => {
    expect(parseGiftCardId("12")).toBe(12);
    expect(parseGiftCardId("0")).toBeNull();
    expect(parseGiftCardId("-1")).toBeNull();
    expect(parseGiftCardId("1e3")).toBeNull();
    expect(parseGiftCardId("99999999999")).toBeNull();
    expect(parseGiftCardId(undefined)).toBeNull();
  });
});
