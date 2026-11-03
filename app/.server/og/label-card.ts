import { renderAsync } from "@resvg/resvg-js";
import { labelPalette, layoutLabelText, type ProductLabel } from "~/lib/label-art";
import { SHARE_IMAGE_SIZE } from "~/lib/products";
import { OG_FONTS, ogFontFiles } from "./fonts";
// The shop's own bottle photo (every perfume comes in the same JASSMIN bottle), 504×630 with its
// metadata stripped. Inlined as a data URL, so the server build needs no file next to it.
import shareBottle from "./share-bottle.jpg?inline";

// The share image of a product without its own photo (#105): the bottle photo on the left, and the
// brand and name on a panel in the product's fragrance-family palette (#99) on the right, so a
// shared link shows which perfume it is. 1200×630, the size messengers expect.

/** Bump when the photo or the layout changes, so caches and crawlers fetch the new image. */
export const CARD_VERSION = 1;

export const CARD_WIDTH = SHARE_IMAGE_SIZE.width;
export const CARD_HEIGHT = SHARE_IMAGE_SIZE.height;
export const PHOTO_WIDTH = 504;
const STRIP_WIDTH = 8;
const TEXT_X = 576;
const TEXT_WIDTH = CARD_WIDTH - TEXT_X - 64;
/** The text block is centred above the wordmark's row. */
const TEXT_AREA_HEIGHT = 540;

const BRAND_SIZES = [34, 30, 26] as const;
/** Capitals in Manrope 800 plus the letter-spacing, as a share of the font size (as on the card). */
const BRAND_GLYPH_WIDTH = 0.8;
const BRAND_LETTER_SPACING = 4;
const NAME_SIZES = [76, 64, 54, 46] as const;
const RULE = { width: 56, height: 3, gapBefore: 26, gapAfter: 40 };

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

function textLines(
  lines: readonly string[],
  { x, firstBaseline, lineHeight }: { x: number; firstBaseline: number; lineHeight: number },
): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</text>`,
    )
    .join("");
}

/** The share image as SVG markup. */
export function shareCardSvg(label: ProductLabel): string {
  const palette = labelPalette(label.family);
  const brand = layoutLabelText(label.brand.toLocaleUpperCase(), {
    width: TEXT_WIDTH,
    maxLines: 2,
    sizes: BRAND_SIZES,
    glyphWidth: BRAND_GLYPH_WIDTH,
  });
  const name = layoutLabelText(label.title, { width: TEXT_WIDTH, maxLines: 3, sizes: NAME_SIZES });
  const brandLineHeight = Math.round(brand.fontSize * 1.3);
  const nameLineHeight = Math.round(name.fontSize * 1.12);
  const brandHeight = brand.lines.length * brandLineHeight;
  const nameHeight = name.lines.length * nameLineHeight;
  const ruleBlock = RULE.gapBefore + RULE.height + RULE.gapAfter;
  const top = Math.round((TEXT_AREA_HEIGHT - (brandHeight + ruleBlock + nameHeight)) / 2) + 24;
  const ruleY = top + brandHeight + RULE.gapBefore;
  const nameTop = ruleY + RULE.height + RULE.gapAfter;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.bg}"/>`,
    `<image href="${shareBottle}" x="0" y="0" width="${PHOTO_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`,
    `<rect x="${PHOTO_WIDTH}" width="${STRIP_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.accent}"/>`,
    `<g fill="${palette.mark}" font-family="${OG_FONTS.sans}" font-weight="800" font-size="${brand.fontSize}" letter-spacing="${BRAND_LETTER_SPACING}">`,
    textLines(brand.lines, {
      x: TEXT_X,
      firstBaseline: top + Math.round(brand.fontSize * 0.9),
      lineHeight: brandLineHeight,
    }),
    "</g>",
    `<rect x="${TEXT_X}" y="${ruleY}" width="${RULE.width}" height="${RULE.height}" fill="${palette.mark}" opacity="0.45"/>`,
    `<g fill="${palette.mark}" font-family="${OG_FONTS.serif}" font-weight="700" font-size="${name.fontSize}">`,
    textLines(name.lines, {
      x: TEXT_X,
      firstBaseline: nameTop + Math.round(name.fontSize * 0.85),
      lineHeight: nameLineHeight,
    }),
    "</g>",
    `<text x="${CARD_WIDTH - 64}" y="${CARD_HEIGHT - 48}" text-anchor="end" fill="${palette.mark}" font-family="${OG_FONTS.serif}" font-weight="700" font-size="30">jassmin.</text>`,
    "</svg>",
  ].join("");
}

/** The share image as PNG bytes, rendered off the event loop. */
export async function renderShareCardPng(label: ProductLabel): Promise<Buffer> {
  const image = await renderAsync(shareCardSvg(label), {
    fitTo: { mode: "original" },
    font: {
      fontFiles: ogFontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: OG_FONTS.sans,
    },
  });
  return image.asPng();
}

/** A strong ETag: changes when the product's row or the card's design does. */
export function shareCardEtag(publicId: string, updatedAt: Date): string {
  return `"${publicId}-${updatedAt.getTime().toString(36)}-v${CARD_VERSION}"`;
}
