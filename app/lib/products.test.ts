import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";
import { formatPrice } from "./money";
import { cardPrice, defaultVariant, formatVariantOption, formatVolume } from "./products";

const en = createTranslator("en");

describe("formatVolume", () => {
  it("shows the volume of a single bottle", () => {
    expect(formatVolume({ volumeMl: 50, packSize: 1 }, en)).toBe("50 ml");
    expect(formatVolume({ volumeMl: 50, packSize: 1 })).toBe("50 мл");
  });

  it("shows the unit count and volume of a pack", () => {
    expect(formatVolume({ volumeMl: 10, packSize: 3 }, en)).toBe("3 × 10 ml");
  });
});

describe("defaultVariant", () => {
  const size = (volumeMl: number, inStock: boolean) => ({ volumeMl, inStock });

  it("picks the smallest size in stock", () => {
    expect(defaultVariant([size(50, true), size(7, false), size(10, true)])).toEqual(
      size(10, true),
    );
  });

  it("falls back to the smallest size when none is in stock", () => {
    expect(defaultVariant([size(50, false), size(10, false)])).toEqual(size(10, false));
  });

  it("is undefined without sizes", () => {
    expect(defaultVariant([])).toBeUndefined();
  });
});

describe("cardPrice", () => {
  const product = {
    minPrice: "990.00",
    defaultVariant: { id: "v10", volumeMl: 10 },
    variants: [
      { id: "v7", volumeMl: 7, price: "990.00", inStock: false },
      { id: "v10", volumeMl: 10, price: "1350.00", inStock: true },
      { id: "v30", volumeMl: 30, price: "4450.00", inStock: true },
    ],
  };

  it("is the price of the picked size", () => {
    expect(cardPrice(product, "v30")).toBe("4450.00");
    expect(cardPrice(product, "v10")).toBe("1350.00");
  });

  it("falls back to the default size for an unknown id", () => {
    expect(cardPrice(product, "nope")).toBe("1350.00");
  });
});

describe("formatVariantOption", () => {
  it("shows the volume and price", () => {
    expect(formatVariantOption({ volumeMl: 30, price: "1450.00", inStock: true }, 1, en)).toBe(
      `30 ml — ${formatPrice("1450.00", "en")}`,
    );
  });

  it("marks sizes that are out of stock", () => {
    expect(formatVariantOption({ volumeMl: 10, price: "900.00", inStock: false }, 3, en)).toBe(
      `3 × 10 ml — ${formatPrice("900.00", "en")} (out of stock)`,
    );
    expect(formatVariantOption({ volumeMl: 10, price: "900.00", inStock: false }, 1)).toBe(
      `10 мл — ${formatPrice("900.00")} (немає в наявності)`,
    );
  });
});
