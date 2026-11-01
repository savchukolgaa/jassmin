// The popular perfumes page `/popular` (#67): staff-ranked perfumes, topped up from the
// bestsellers, optionally narrowed to the trio builder's families. Isomorphic: no server imports.
import { z } from "zod";
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

/** What the page renders: a page of perfumes and the families it is narrowed to, in pick order. */
export interface PopularPageView extends PopularPage {
  families: TrioFamily[];
}

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

/** The `page` search param, like the catalog's: 1 when missing or invalid. */
export function parsePopularPage(params: URLSearchParams): number {
  return pageSchema.parse(params.get("page") ?? undefined);
}

/**
 * The popular perfumes in `locale`, narrowed to `families` (stored values, in pick order), at
 * `page`; 1 is omitted.
 */
export function popularHref(locale: Locale, families: readonly string[], page = 1): string {
  const params = new URLSearchParams(families.map((family) => ["family", family]));
  if (page > 1) params.set("page", String(page));
  return pathFor(locale, "popular", {}, { search: params });
}
