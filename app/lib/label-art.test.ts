import { describe, expect, it } from "vitest";
import { FRAGRANCE_FAMILIES } from "./enums";
import {
  BOTTLE_SHAPES,
  CAP_SHAPES,
  contrastRatio,
  FAMILY_PALETTE,
  LABEL_PALETTE_KEYS,
  LABEL_PALETTES,
  labelPalette,
  labelPaletteKey,
  labelVariant,
  layoutLabelText,
} from "./label-art";

describe("labelPalette (#99)", () => {
  it("gives every fragrance family a palette", () => {
    for (const family of FRAGRANCE_FAMILIES) {
      expect(LABEL_PALETTE_KEYS).toContain(FAMILY_PALETTE[family]);
      expect(labelPaletteKey(family)).not.toBe("neutral");
    }
  });

  it("is neutral without a family or for an unknown one", () => {
    expect(labelPaletteKey(null)).toBe("neutral");
    expect(labelPaletteKey("ambery")).toBe("neutral");
    expect(labelPalette(null)).toBe(LABEL_PALETTES.neutral);
  });

  it("colours different families differently", () => {
    expect(labelPalette("квіткові").bg).not.toBe(labelPalette("деревні").bg);
    expect(labelPalette("свіжі").bg).not.toBe(labelPalette("східні").bg);
  });

  it("has no two palettes with the same background", () => {
    const backgrounds = Object.values(LABEL_PALETTES).map((palette) => palette.bg);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });

  it.each(LABEL_PALETTE_KEYS)("meets WCAG AA for the text of %s", (key) => {
    const palette = LABEL_PALETTES[key];
    expect(contrastRatio(palette.ink, palette.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.mark, palette.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // `primary` on white, from docs/design.md.
    expect(contrastRatio("#C22F4B", "#FFFFFF")).toBeCloseTo(5.52, 1);
  });
});

describe("labelVariant (#99)", () => {
  const ids = Array.from(
    { length: 200 },
    (_, i) =>
      `0193${i.toString(16).padStart(4, "0")}-7c1e-7a2b-9f00-${(i * 7919).toString(16).padStart(12, "0")}`,
  );

  it("is the same for the same id", () => {
    expect(labelVariant("0193a1b2-7c1e-7a2b-9f00-000000000001")).toEqual(
      labelVariant("0193a1b2-7c1e-7a2b-9f00-000000000001"),
    );
  });

  it("stays in range and uses every shape", () => {
    const bottles = new Set<number>();
    const caps = new Set<number>();
    for (const id of ids) {
      const { bottle, cap } = labelVariant(id);
      expect(bottle).toBeGreaterThanOrEqual(0);
      expect(bottle).toBeLessThan(BOTTLE_SHAPES);
      expect(cap).toBeGreaterThanOrEqual(0);
      expect(cap).toBeLessThan(CAP_SHAPES);
      bottles.add(bottle);
      caps.add(cap);
    }
    expect(bottles.size).toBe(BOTTLE_SHAPES);
    expect(caps.size).toBe(CAP_SHAPES);
  });

  it("gives neighbouring ids different shapes", () => {
    const combos = new Set(ids.map((id) => JSON.stringify(labelVariant(id))));
    expect(combos.size).toBe(BOTTLE_SHAPES * CAP_SHAPES);
  });
});

describe("layoutLabelText (#99)", () => {
  const options = { width: 180, maxLines: 3, sizes: [30, 26, 22, 19] };

  it("keeps a short name on one line at the largest size", () => {
    expect(layoutLabelText("Coco", options)).toEqual({
      lines: ["Coco"],
      fontSize: 30,
    });
  });

  it("wraps a long Latin name and makes it smaller", () => {
    const layout = layoutLabelText("Eau de Parfum Intense Pour Homme", options);
    expect(layout.lines.length).toBeLessThanOrEqual(3);
    expect(layout.lines.join(" ")).toBe("Eau de Parfum Intense Pour Homme");
    expect(layout.fontSize).toBeLessThan(30);
  });

  it("wraps Cyrillic names on spaces", () => {
    const layout = layoutLabelText("Квітковий сад у травні", options);
    expect(layout.lines.join(" ")).toBe("Квітковий сад у травні");
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it("gets smaller as the name gets longer", () => {
    const short = layoutLabelText("Libre", options).fontSize;
    const medium = layoutLabelText("Libre Intense", options).fontSize;
    const long = layoutLabelText("Libre Intense Eau de Parfum Collector", options).fontSize;
    expect(short).toBeGreaterThanOrEqual(medium);
    expect(medium).toBeGreaterThanOrEqual(long);
    expect(short).toBeGreaterThan(long);
  });

  it("breaks a word longer than a line", () => {
    const layout = layoutLabelText("Супердовганазвабезпробілівтакадовга", options);
    expect(layout.fontSize).toBe(19);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.every((line) => line.length <= 16)).toBe(true);
  });

  it("ends with an ellipsis when it doesn't fit the lines", () => {
    const layout = layoutLabelText(
      "One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen",
      options,
    );
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[2]?.endsWith("…")).toBe(true);
  });

  it("collapses whitespace and handles an empty name", () => {
    expect(layoutLabelText("  Coco   Noir ", options).lines).toEqual(["Coco Noir"]);
    expect(layoutLabelText("   ", options).lines).toEqual([]);
  });
});
