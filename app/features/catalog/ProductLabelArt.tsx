import type { ReactElement } from "react";
import { labelPalette, labelVariant, layoutLabelText, type ProductLabel } from "~/lib/label-art";

export interface ProductLabelArtProps {
  label: ProductLabel;
  /** `minimal` draws only the bottle, for thumbnails too small to read text on. */
  detail?: "full" | "minimal";
  className?: string;
}

// Geometry in a 400×500 (4:5) viewBox. The label panel sits on the same spot on every bottle.
const CENTER = 200;
const PANEL = { x: 110, y: 250, width: 180, height: 160 };
const TEXT_WIDTH = 160;
const BRAND_Y = 280;
/** The middle of the name's lines, between the brand and the panel's bottom. */
const NAME_MIDDLE = 352;
const NAME_SIZES = [30, 26, 22, 19] as const;
const BRAND_LINE_HEIGHT = 12;
/** Capitals in Manrope 800 plus the 1.5-unit letter-spacing, as a share of the font size. */
const BRAND_GLYPH_WIDTH = 0.8;

const BOTTLES: readonly ((fill: string) => ReactElement)[] = [
  (fill) => <rect x="95" y="150" width="210" height="290" rx="18" fill={fill} />,
  (fill) => <rect x="95" y="140" width="210" height="300" rx="70" fill={fill} />,
  (fill) => <path d="M125 150H275L305 190V400L275 440H125L95 400V190Z" fill={fill} />,
  (fill) => <path d="M95 440V245A105 105 0 0 1 305 245V440Z" fill={fill} />,
];

const CAPS: readonly ((fill: string) => ReactElement)[] = [
  (fill) => <rect x="162" y="58" width="76" height="64" rx="8" fill={fill} />,
  (fill) => <circle cx="200" cy="88" r="34" fill={fill} />,
  (fill) => <rect x="138" y="92" width="124" height="30" rx="6" fill={fill} />,
];

/**
 * The generated picture of a product without a photo (#99): a bottle in the colours of its primary
 * fragrance family, its shape picked by the product id, with the brand and name on the label. Pure
 * inline SVG: no requests and the same markup on the server and the client. Decorative; the
 * caller labels it (see `ProductImage`).
 */
export function ProductLabelArt({ label, detail = "full", className }: ProductLabelArtProps) {
  const palette = labelPalette(label.family);
  const { bottle, cap } = labelVariant(label.id);
  const drawBottle = BOTTLES[bottle] ?? BOTTLES[0];
  const drawCap = CAPS[cap] ?? CAPS[0];

  return (
    <svg
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="400" height="500" fill={palette.bg} />
      <rect x="178" y="118" width="44" height="40" fill={palette.cap} />
      {drawCap?.(palette.cap)}
      {drawBottle?.(palette.accent)}
      <rect x="115" y="195" width="10" height="44" rx="5" fill="#FFFFFF" opacity="0.35" />
      <rect {...PANEL} rx="10" fill={palette.panel} />
      {detail === "full" && <LabelText label={label} ink={palette.ink} mark={palette.mark} />}
    </svg>
  );
}

function LabelText({ label, ink, mark }: { label: ProductLabel; ink: string; mark: string }) {
  // One line if the brand fits at any size, else two smaller ones (e.g. "Maison Francis Kurkdjian").
  const oneLine = layoutLabelText(label.brand, {
    width: TEXT_WIDTH,
    maxLines: 1,
    sizes: [13, 11, 10],
    glyphWidth: BRAND_GLYPH_WIDTH,
  });
  const brand = oneLine.lines[0]?.endsWith("…")
    ? layoutLabelText(label.brand, {
        width: TEXT_WIDTH,
        maxLines: 2,
        sizes: [11, 10],
        glyphWidth: BRAND_GLYPH_WIDTH,
      })
    : oneLine;
  const brandExtra = (brand.lines.length - 1) * BRAND_LINE_HEIGHT;
  const name = layoutLabelText(label.title, {
    width: TEXT_WIDTH,
    maxLines: 3,
    sizes: NAME_SIZES,
  });
  const lineHeight = Math.round(name.fontSize * 1.15);
  const firstBaseline =
    NAME_MIDDLE +
    brandExtra / 2 -
    ((name.lines.length - 1) * lineHeight) / 2 +
    Math.round(name.fontSize * 0.35);

  return (
    <g textAnchor="middle">
      <g
        fill={ink}
        fontSize={brand.fontSize}
        fontWeight="800"
        letterSpacing="1.5"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {brand.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
          <text key={index} x={CENTER} y={BRAND_Y + index * BRAND_LINE_HEIGHT}>
            {line.toLocaleUpperCase()}
          </text>
        ))}
      </g>
      <rect x="180" y={292 + brandExtra} width="40" height="2" fill={ink} opacity="0.35" />
      <g
        fill={ink}
        fontSize={name.fontSize}
        fontWeight="700"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {name.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
          <text key={index} x={CENTER} y={firstBaseline + index * lineHeight}>
            {line}
          </text>
        ))}
      </g>
      <text
        x={CENTER}
        y="482"
        fill={mark}
        fontSize="22"
        fontWeight="700"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        jassmin.
      </text>
    </g>
  );
}
