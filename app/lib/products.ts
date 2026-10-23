// Product DTOs returned by the catalog and product loaders. `id` is the product's `public_id`;
// the serial id and `created_at` never leave the server. `price` is the exact decimal string.
import type { Gender } from "./enums";

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
