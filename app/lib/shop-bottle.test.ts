import { describe, expect, it } from "vitest";
import { SHOP_BOTTLE_IMAGE } from "./shop-bottle";

describe("SHOP_BOTTLE_IMAGE (#118)", () => {
  it("offers the photo in five widths, smallest first", () => {
    const candidates = (SHOP_BOTTLE_IMAGE.srcSet ?? "").split(", ");

    expect(candidates.map((candidate) => candidate.split(" ")[1])).toEqual([
      "320w",
      "480w",
      "640w",
      "960w",
      "1280w",
    ]);
    for (const candidate of candidates) {
      expect(candidate).toMatch(/shop-bottle-\d+\.webp/);
    }
  });

  it("falls back to the 640px file and keeps the 4:5 frame", () => {
    expect(SHOP_BOTTLE_IMAGE.url).toMatch(/shop-bottle-640\.webp/);
    expect(SHOP_BOTTLE_IMAGE.width).toBe(1280);
    expect(SHOP_BOTTLE_IMAGE.height).toBe(1600);
  });
});
