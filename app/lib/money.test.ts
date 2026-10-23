import { describe, expect, it } from "vitest";
import { formatPrice } from "./money";

// ICU separates thousands and the currency sign with (narrow) no-break spaces.
const normalize = (text: string) => text.replace(/\s/gu, " ");

describe("formatPrice", () => {
  it("formats whole hryvnias without decimals", () => {
    expect(normalize(formatPrice("6850.00"))).toBe("6 850 ₴");
    expect(normalize(formatPrice("990.00"))).toBe("990 ₴");
  });

  it("keeps kopiyky when there are any", () => {
    expect(normalize(formatPrice("990.50"))).toBe("990,5 ₴");
    expect(normalize(formatPrice("1450.05"))).toBe("1 450,05 ₴");
  });
});
