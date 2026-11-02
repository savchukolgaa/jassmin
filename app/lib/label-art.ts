// Generated label cards (#99): the picture of a product without a photo. Its colours come from the
// primary fragrance family and its bottle shape from the product's public id, so it's unique per
// product and the same on every render. Isomorphic and pure: no React, no zod, no server imports.
// The palette is documented in `docs/design.md` ("Label card palette").
import { type FragranceFamily, isFragranceFamily } from "./enums";

/** What a label card needs to know about its product. */
export interface ProductLabel {
  /** The product's `public_id`; picks the bottle shape. */
  id: string;
  brand: string;
  title: string;
  /** The primary fragrance family (stored Ukrainian value); `null` without one. */
  family: string | null;
}

export interface LabelPalette {
  /** The card's background. */
  bg: string;
  /** The bottle. */
  accent: string;
  /** The cap and neck. */
  cap: string;
  /** The label on the bottle, under the brand and name. */
  panel: string;
  /** The brand and name, on `panel`. */
  ink: string;
  /** The "jassmin." wordmark, on `bg`. */
  mark: string;
}

export const LABEL_PALETTE_KEYS = [
  "floral",
  "fruity",
  "oriental",
  "gourmand",
  "woody",
  "fresh",
  "green",
  "aromatic",
  "musky",
  "neutral",
] as const;

export type LabelPaletteKey = (typeof LABEL_PALETTE_KEYS)[number];

export const LABEL_PALETTES: Record<LabelPaletteKey, LabelPalette> = {
  floral: {
    bg: "#FFE3E8",
    accent: "#E86A82",
    cap: "#A8233D",
    panel: "#FFF8F9",
    ink: "#7A1A2E",
    mark: "#A8233D",
  },
  fruity: {
    bg: "#FFE6D6",
    accent: "#F08A5D",
    cap: "#B54A1F",
    panel: "#FFF9F4",
    ink: "#6E2A10",
    mark: "#8F3714",
  },
  oriental: {
    bg: "#4A1F3D",
    accent: "#8E3B6E",
    cap: "#D9A84E",
    panel: "#FBF1F6",
    ink: "#3D1632",
    mark: "#F4DDE9",
  },
  gourmand: {
    bg: "#F6E3CC",
    accent: "#C98B4E",
    cap: "#7A4A22",
    panel: "#FFF9F1",
    ink: "#5A3415",
    mark: "#6E431E",
  },
  woody: {
    bg: "#5B4030",
    accent: "#9A6B4B",
    cap: "#2E1F16",
    panel: "#FAF3EC",
    ink: "#3E2A1E",
    mark: "#F1E3D6",
  },
  fresh: {
    bg: "#DCEEF8",
    accent: "#6FB3D9",
    cap: "#2D6F96",
    panel: "#F7FCFF",
    ink: "#17445E",
    mark: "#1F5A7A",
  },
  green: {
    bg: "#E1F2DC",
    accent: "#7DBF6A",
    cap: "#3E7A2E",
    panel: "#F9FFF6",
    ink: "#23471A",
    mark: "#2F6123",
  },
  aromatic: {
    bg: "#DCEDE8",
    accent: "#5E9E8C",
    cap: "#2F6457",
    panel: "#F6FCFA",
    ink: "#1D4239",
    mark: "#2A5A4E",
  },
  musky: {
    bg: "#ECE4EE",
    accent: "#A893AE",
    cap: "#5E4B66",
    panel: "#FCF9FD",
    ink: "#3F3146",
    mark: "#5E4B66",
  },
  neutral: {
    bg: "#F7F3F4",
    accent: "#D9CDD1",
    cap: "#5F5558",
    panel: "#FFFFFF",
    ink: "#1F1A1C",
    mark: "#5F5558",
  },
};

/** Which palette each family uses; similar families share one. Add new families here. */
export const FAMILY_PALETTE: Record<FragranceFamily, LabelPaletteKey> = {
  квіткові: "floral",
  альдегідні: "floral",
  фруктові: "fruity",
  східні: "oriental",
  пряні: "oriental",
  гурманські: "gourmand",
  ванільні: "gourmand",
  деревні: "woody",
  шипрові: "woody",
  свіжі: "fresh",
  водяні: "fresh",
  зелені: "green",
  цитрусові: "green",
  ароматичні: "aromatic",
  фужерні: "aromatic",
  мускусні: "musky",
};

/** The palette key of a stored family; `neutral` without one or for a pre-#65 value. */
export function labelPaletteKey(family: string | null): LabelPaletteKey {
  return family !== null && isFragranceFamily(family) ? FAMILY_PALETTE[family] : "neutral";
}

export function labelPalette(family: string | null): LabelPalette {
  return LABEL_PALETTES[labelPaletteKey(family)];
}

export const BOTTLE_SHAPES = 4;
export const CAP_SHAPES = 3;

export interface LabelVariant {
  /** `0 … BOTTLE_SHAPES - 1` */
  bottle: number;
  /** `0 … CAP_SHAPES - 1` */
  cap: number;
}

/** 32-bit FNV-1a of the string's UTF-16 code units. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The bottle and cap of a product, from its id: the same id always gets the same shapes. */
export function labelVariant(id: string): LabelVariant {
  const hash = fnv1a(id);
  return {
    bottle: hash % BOTTLE_SHAPES,
    cap: Math.floor(hash / BOTTLE_SHAPES) % CAP_SHAPES,
  };
}

export interface LabelTextOptions {
  /** The space the text has, in the same units as the font sizes. */
  width: number;
  maxLines: number;
  /** Candidate font sizes, largest first; the largest that fits is used. */
  sizes: readonly number[];
  /**
   * Average glyph width as a share of the font size; deliberately on the wide side, so Cyrillic
   * and capitals fit too.
   */
  glyphWidth?: number;
}

export interface LabelTextLayout {
  lines: string[];
  fontSize: number;
}

const DEFAULT_GLYPH_WIDTH = 0.58;
const ELLIPSIS = "…";

/** Wraps on spaces into lines of at most `maxChars`; a longer word is broken. */
function wrap(text: string, maxChars: number): { lines: string[]; broken: boolean } {
  const lines: string[] = [];
  let broken = false;
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > maxChars) {
      broken = true;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (!line) {
      line = rest;
    } else if (line.length + 1 + rest.length <= maxChars) {
      line = `${line} ${rest}`;
    } else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) {
    lines.push(line);
  }
  return { lines, broken };
}

/**
 * Fits text into a box without measuring it (it runs on the server too): by character count, the
 * largest font size whose wrapped lines fit `maxLines` without breaking a word. Otherwise the
 * smallest size, with words broken and an ellipsis after the last line.
 */
export function layoutLabelText(text: string, options: LabelTextOptions): LabelTextLayout {
  const { width, maxLines, sizes } = options;
  const glyphWidth = options.glyphWidth ?? DEFAULT_GLYPH_WIDTH;
  const charsAt = (size: number) => Math.max(1, Math.floor(width / (size * glyphWidth)));
  const finish = (lines: string[], fontSize: number): LabelTextLayout => ({ lines, fontSize });

  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { lines: [], fontSize: sizes[0] ?? 0 };
  }

  for (const size of sizes) {
    const { lines, broken } = wrap(normalized, charsAt(size));
    if (!broken && lines.length <= maxLines) {
      return finish(lines, size);
    }
  }

  const smallest = sizes[sizes.length - 1] ?? 0;
  const maxChars = charsAt(smallest);
  const { lines } = wrap(normalized, maxChars);
  if (lines.length <= maxLines) {
    return finish(lines, smallest);
  }
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] =
    last.length < maxChars ? `${last}${ELLIPSIS}` : `${last.slice(0, maxChars - 1)}${ELLIPSIS}`;
  return finish(kept, smallest);
}

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two `#RRGGBB` colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
