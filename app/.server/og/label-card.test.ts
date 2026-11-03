import { describe, expect, it } from "vitest";
import { LABEL_PALETTES, type ProductLabel } from "~/lib/label-art";
import {
  CARD_HEIGHT,
  CARD_VERSION,
  CARD_WIDTH,
  renderShareCardPng,
  shareCardEtag,
  shareCardSvg,
} from "./label-card";

const label: ProductLabel = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  brand: "Maison Francis Kurkdjian",
  title: "Baccarat Rouge 540",
  family: "квіткові",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The width and height in a PNG's IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("shareCardSvg", () => {
  it("draws the bottle photo and the brand and name in the family palette", () => {
    const svg = shareCardSvg(label);
    const { bg, accent, mark } = LABEL_PALETTES.floral;

    expect(svg).toContain(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`);
    expect(svg).toMatch(/<image href="data:image\/jpeg;base64,[A-Za-z0-9+/]+=*"/);
    expect(svg).toContain(`fill="${bg}"`);
    expect(svg).toContain(`fill="${accent}"`);
    expect(svg).toContain(`fill="${mark}"`);
    // A long brand wraps onto two lines rather than shrinking too far.
    expect(svg).toContain(">MAISON FRANCIS<");
    expect(svg).toContain(">KURKDJIAN<");
    expect(svg).toContain(">Baccarat<");
    expect(svg).toContain(">Rouge 540<");
    expect(svg).toContain('font-family="Manrope ExtraBold"');
    expect(svg).toContain('font-family="Playfair Display"');
    expect(svg).toContain(">jassmin.<");
  });

  it("uses the neutral palette without a family", () => {
    expect(shareCardSvg({ ...label, family: null })).toContain(
      `fill="${LABEL_PALETTES.neutral.bg}"`,
    );
  });

  it("escapes the text", () => {
    const svg = shareCardSvg({ ...label, brand: "A&B", title: `<Rose> "5"` });

    expect(svg).toContain(">A&amp;B<");
    expect(svg).toContain(">&lt;Rose&gt; &quot;5&quot;<");
    expect(svg).not.toContain("<Rose>");
  });
});

describe("renderShareCardPng", () => {
  it("renders a 1200×630 PNG for a Latin and a Cyrillic name", async () => {
    const latin = await renderShareCardPng(label);
    const cyrillic = await renderShareCardPng({ ...label, title: "Жасминовий ранок" });

    expect(pngSize(latin)).toEqual({ width: 1200, height: 630 });
    expect(pngSize(cyrillic)).toEqual({ width: 1200, height: 630 });
  });

  it("draws the Cyrillic glyphs", async () => {
    const cyrillic = await renderShareCardPng({ ...label, title: "Жасминовий ранок" });
    const empty = await renderShareCardPng({ ...label, title: "" });

    expect(cyrillic.equals(empty)).toBe(false);
  });
});

describe("shareCardEtag", () => {
  it("changes with the product's update time", () => {
    const etag = shareCardEtag(label.id, new Date("2026-11-01T10:00:00Z"));

    expect(etag).toMatch(new RegExp(`^"${label.id}-[0-9a-z]+-v${CARD_VERSION}"$`));
    expect(shareCardEtag(label.id, new Date("2026-11-02T10:00:00Z"))).not.toBe(etag);
  });
});
