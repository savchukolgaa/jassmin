import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { woffToSfnt } from "./woff";

// The fonts of the share image (#105): Playfair Display 700 and Manrope 800, the site's typefaces
// (#73), in the Latin and Cyrillic subsets. The static `@fontsource` builds, not the variable ones
// the site loads: resvg reads only TTF/OTF and doesn't instance a variable font at a weight.

/** The `font-family` names inside the files (Manrope's 800 files call themselves "ExtraBold"). */
export const OG_FONTS = { sans: "Manrope ExtraBold", serif: "Playfair Display" } as const;

const FONT_FILES = [
  ...["latin", "latin-ext", "cyrillic"].map(
    (subset) => `@fontsource/playfair-display/files/playfair-display-${subset}-700-normal.woff`,
  ),
  ...["latin", "latin-ext", "cyrillic", "cyrillic-ext"].map(
    (subset) => `@fontsource/manrope/files/manrope-${subset}-800-normal.woff`,
  ),
];

const require = createRequire(import.meta.url);

/** Where the converted fonts are written; their names are content hashes, so writes are safe. */
export const OG_FONT_DIR = join(tmpdir(), "jassmin-og-fonts");

let fontPaths: string[] | undefined;

/**
 * The share image's fonts as `.ttf` files, converted once per process. resvg-js gets them as
 * files: given as `fontBuffers`, resvg-js 2.6 picked the wrong face for Manrope.
 */
export function ogFontFiles(): string[] {
  if (!fontPaths) {
    mkdirSync(OG_FONT_DIR, { recursive: true });
    fontPaths = FONT_FILES.map((file) => {
      const sfnt = woffToSfnt(readFileSync(require.resolve(file)));
      const hash = createHash("sha256").update(sfnt).digest("hex").slice(0, 16);
      const path = join(OG_FONT_DIR, `${hash}.ttf`);
      if (!existsSync(path)) {
        writeFileSync(path, sfnt);
      }
      return path;
    });
  }
  return fontPaths;
}
