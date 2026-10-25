import { describe, expect, it } from "vitest";
import { formatPrice, fromKopiyky, toKopiyky } from "./money";

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

describe("formatPrice in English", () => {
  it("puts the hryvnia sign first and groups with commas", () => {
    expect(formatPrice("6850.00", "en")).toBe("₴6,850");
    expect(formatPrice("1450.05", "en")).toBe("₴1,450.05");
  });
});

describe("toKopiyky", () => {
  it("reads exact decimal strings as whole kopiyky", () => {
    expect(toKopiyky("0")).toBe(0);
    expect(toKopiyky("999.5")).toBe(99950);
    expect(toKopiyky("1000.00")).toBe(100000);
    expect(toKopiyky("0.07")).toBe(7);
  });

  it("refuses anything that isn't a non-negative amount", () => {
    for (const amount of ["", "-1.00", "1.234", "1,50", "abc", "1e3"]) {
      expect(() => toKopiyky(amount)).toThrow(/Not a money amount/);
    }
  });
});

describe("fromKopiyky", () => {
  it("writes whole kopiyky as a numeric(10, 2) string", () => {
    expect(fromKopiyky(0)).toBe("0.00");
    expect(fromKopiyky(7)).toBe("0.07");
    expect(fromKopiyky(99950)).toBe("999.50");
    expect(fromKopiyky(toKopiyky("4450.00"))).toBe("4450.00");
  });

  it("refuses fractions and negative amounts", () => {
    for (const kopiyky of [-1, 0.5, Number.NaN]) {
      expect(() => fromKopiyky(kopiyky)).toThrow(/Not a kopiyky amount/);
    }
  });
});
