// The popular perfumes page `/popular` (#67): staff-ranked perfumes, topped up from the
// bestsellers, optionally narrowed to the trio builder's gender and families. Isomorphic: no server
// imports.
import type { CatalogGender } from "./catalog";
import type { TextKey } from "./i18n";
import type { Locale } from "./i18n/locales";
import { pathFor } from "./paths";
import type { ProductSummary } from "./products";
import type { TrioFamily } from "./trio";

/** One page of the popular perfumes. */
export interface PopularPage {
  products: ProductSummary[];
  /** Perfumes on the list across all pages. */
  total: number;
  page: number;
  /** At least 1, so an empty list still has a page. */
  pageCount: number;
}

/**
 * What `/popular` is narrowed to (#102): the trio builder's families (stored values, in pick
 * order; none means every family) and its gender (`null` means every gender).
 */
export interface PopularFilter {
  families: readonly string[];
  gender: CatalogGender | null;
}

/** The active gender filter's chip and the switch to the other one (#102): "Жінки" / "Women". */
export const POPULAR_GENDER_KEYS = {
  men: "popular.gender.men",
  women: "popular.gender.women",
} as const satisfies Record<CatalogGender, TextKey>;

/**
 * What the page renders: a page of perfumes, the families it is narrowed to (in pick order) and
 * the gender, if any.
 */
export interface PopularPageView extends PopularPage {
  families: TrioFamily[];
  gender: CatalogGender | null;
}

/**
 * The popular perfumes in `locale` narrowed to `filter`, at `page`; 1 is omitted. The params go
 * `gender`, then each `family`, then `page`.
 */
export function popularHref(locale: Locale, filter: PopularFilter, page = 1): string {
  const params = new URLSearchParams();
  if (filter.gender) params.set("gender", filter.gender);
  for (const family of filter.families) params.append("family", family);
  if (page > 1) params.set("page", String(page));
  return pathFor(locale, "popular", {}, { search: params });
}
