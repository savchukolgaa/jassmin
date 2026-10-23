import { describe, expect, it } from "vitest";
import { formatPrice } from "./money";
import { defaultVariant, formatVariantOption, formatVolume, formatVolumes } from "./products";

describe("formatVolume", () => {
  it("shows the volume of a single bottle", () => {
    expect(formatVolume({ volumeMl: 50, packSize: 1 })).toBe("50 ml");
  });

  it("shows the unit count and volume of a pack", () => {
    expect(formatVolume({ volumeMl: 10, packSize: 3 })).toBe("3 × 10 ml");
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

describe("formatVolumes", () => {
  it("lists the sizes", () => {
    expect(formatVolumes({ volumes: [10, 30, 50], packSize: 1 })).toBe("10 · 30 · 50 ml");
    expect(formatVolumes({ volumes: [100], packSize: 1 })).toBe("100 ml");
  });

  it("shows the unit count of a pack", () => {
    expect(formatVolumes({ volumes: [10], packSize: 3 })).toBe("3 × 10 ml");
  });

  it("is empty without sizes", () => {
    expect(formatVolumes({ volumes: [], packSize: 1 })).toBe("");
  });
});

describe("formatVariantOption", () => {
  it("shows the volume and price", () => {
    expect(formatVariantOption({ volumeMl: 30, price: "1450.00", inStock: true }, 1)).toBe(
      `30 ml — ${formatPrice("1450.00")}`,
    );
  });

  it("marks sizes that are out of stock", () => {
    expect(formatVariantOption({ volumeMl: 10, price: "900.00", inStock: false }, 3)).toBe(
      `3 × 10 ml — ${formatPrice("900.00")} (out of stock)`,
    );
  });
});
