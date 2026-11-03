import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OG_FONT_DIR, ogFontFiles } from "./fonts";

describe("ogFontFiles", () => {
  it("writes the Playfair Display and Manrope subsets as TrueType files, once", () => {
    const files = ogFontFiles();

    expect(files).toHaveLength(7);
    expect(new Set(files).size).toBe(7);
    for (const file of files) {
      expect(file.startsWith(OG_FONT_DIR)).toBe(true);
      expect(readFileSync(file).readUInt32BE(0)).toBe(0x00010000);
    }
    expect(ogFontFiles()).toBe(files);
  });
});
