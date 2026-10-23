import { describe, expect, it } from "vitest";
import { formatVolume } from "./products";

describe("formatVolume", () => {
  it("shows the volume of a single bottle", () => {
    expect(formatVolume({ volumeMl: 50, packSize: 1 })).toBe("50 ml");
  });

  it("shows the unit count and volume of a pack", () => {
    expect(formatVolume({ volumeMl: 10, packSize: 3 })).toBe("3 × 10 ml");
  });
});
