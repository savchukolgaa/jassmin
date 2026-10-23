// Product DTOs returned by the catalog and product loaders. `id` is the product's `public_id`;
// the serial id and `created_at` never leave the server. `price` is the exact decimal string.
import type { Gender } from "./enums";
import { formatPrice } from "./money";

export interface ProductSummary {
  id: string;
  title: string;
  brand: string;
  gender: Gender;
  price: string;
  volumeMl: number;
  packSize: number;
  imageUrl: string | null;
  inStock: boolean;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  fragranceFamily: string | null;
  stockQuantity: number;
}

export interface CatalogFilterOptions {
  brands: string[];
  fragranceFamilies: string[];
}

export interface CatalogPage {
  products: ProductSummary[];
  /** Products matching the filters, across all pages. */
  total: number;
  page: number;
  /** At least 1, so an empty catalog still has a page. */
  pageCount: number;
  filterOptions: CatalogFilterOptions;
}

/** Stock at or below this shows "Only N left". */
export const LOW_STOCK_THRESHOLD = 3;

/** `50 ml`, or `3 × 10 ml` for a pack of several units. */
export function formatVolume({
  volumeMl,
  packSize,
}: Pick<ProductSummary, "volumeMl" | "packSize">) {
  return packSize > 1 ? `${packSize} × ${volumeMl} ml` : `${volumeMl} ml`;
}

/** One size of a product. `id` is the variant's `public_id`, posted as `variantId`. */
export interface ProductVariant {
  id: string;
  volumeMl: number;
  price: string;
  stockQuantity: number;
  inStock: boolean;
}

/**
 * The size preselected for a product: the smallest one in stock, else the smallest one.
 * `undefined` when the product has no sizes.
 */
export function defaultVariant<T extends Pick<ProductVariant, "volumeMl" | "inStock">>(
  variants: readonly T[],
): T | undefined {
  const sorted = [...variants].sort((a, b) => a.volumeMl - b.volumeMl);
  return sorted.find((v) => v.inStock) ?? sorted[0];
}

/** The sizes on a card, e.g. `10 · 30 · 50 ml`, or `3 × 10 ml` for a pack. */
export function formatVolumes({
  volumes,
  packSize,
}: {
  volumes: readonly number[];
  packSize: number;
}) {
  if (volumes.length === 0) {
    return "";
  }
  const units = volumes.map((v) => (packSize > 1 ? `${packSize} × ${v}` : String(v)));
  return `${units.join(" · ")} ml`;
}

/** A volume dropdown option, e.g. `30 ml — 1 450 ₴`, marked when that size is sold out. */
export function formatVariantOption(
  variant: Pick<ProductVariant, "volumeMl" | "price" | "inStock">,
  packSize: number,
) {
  const label = `${formatVolume({ volumeMl: variant.volumeMl, packSize })} — ${formatPrice(variant.price)}`;
  return variant.inStock ? label : `${label} (out of stock)`;
}
