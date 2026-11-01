// Responsive images (#88): one `srcset` builder for CMS content and product photos, and the
// `sizes` of each product image layout. Isomorphic: no server imports.

/** One resized version of an image, e.g. Strapi's `small` format. */
export interface ImageCandidate {
  url: string;
  width: number;
}

/** A resized version with its height, as the product sync stores it (`products.image_formats`). */
export interface ImageFormat extends ImageCandidate {
  height: number;
}

/** What an `<img>` needs to load the right size without shifting the layout. */
export interface ResponsiveImage {
  /** Absolute URL of the original, the `src` fallback. */
  url: string;
  /** `srcset` of the resized versions plus the original; `null` when no width is known. */
  srcSet: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Builds an `srcset` from the candidates, smallest first, one URL per width (a later candidate
 * wins). Returns `null` when there are none.
 */
export function buildSrcSet(candidates: readonly ImageCandidate[]): string | null {
  const byWidth = new Map<number, string>();
  for (const { url, width } of candidates) {
    if (Number.isInteger(width) && width > 0) {
      byWidth.set(width, url);
    }
  }
  if (byWidth.size === 0) {
    return null;
  }
  return [...byWidth]
    .sort(([a], [b]) => a - b)
    .map(([width, url]) => `${url} ${width}w`)
    .join(", ");
}

/**
 * A product photo from its stored columns: the original URL, its size and Strapi's resized
 * formats. `null` without a URL. Without sizes it's a plain `src`.
 */
export function toResponsiveImage(
  url: string | null,
  width: number | null,
  height: number | null,
  formats: readonly ImageFormat[] | null,
): ResponsiveImage | null {
  if (!url) {
    return null;
  }
  const candidates: ImageCandidate[] = [...(formats ?? [])];
  if (width) {
    candidates.push({ url, width });
  }
  return { url, srcSet: buildSrcSet(candidates), width, height };
}

/**
 * The `sizes` attribute for each product image layout: how wide the image is shown at each
 * breakpoint, following the grids in `routes/catalog.tsx`, `features/home/Bestsellers.tsx` and
 * `routes/product.tsx` (`container` stops at 1536px).
 */
export const PRODUCT_IMAGE_SIZES = {
  /** Catalog and offer cards: 1 → 2 (`sm`) → 3 (`lg`) → 4 (`xl`) columns. */
  card: "(min-width: 1280px) 22vw, (min-width: 1024px) 30vw, (min-width: 640px) 46vw, 92vw",
  /** Bestseller and popular cards: 1 → 2 (`sm`) → 4 (`lg`) columns. */
  compact: "(min-width: 1024px) 22vw, (min-width: 640px) 46vw, 92vw",
  /** The product page photo: full width, half from `md`. */
  page: "(min-width: 1536px) 720px, (min-width: 768px) 46vw, 92vw",
  /** Cart and order line thumbnails. */
  thumb: "96px",
} as const;

export type ProductImageLayout = keyof typeof PRODUCT_IMAGE_SIZES;
