// The popular perfumes page `/popular` (#67): staff-ranked perfumes, topped up from the
// bestsellers. Isomorphic: no server imports.
import type { ProductSummary } from "./products";

export const POPULAR_PATH = "/popular";

/** One page of the popular perfumes. */
export interface PopularPage {
  products: ProductSummary[];
  /** Perfumes on the list across all pages. */
  total: number;
  page: number;
  /** At least 1, so an empty list still has a page. */
  pageCount: number;
}
