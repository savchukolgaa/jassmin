// Catalog URL contract: which genders have a catalog page, and the filter/sort/page search params.
// Parsed with zod on the server; invalid values fall back to their defaults so a bad URL never errors.
import { z } from "zod";

export const CATALOG_TITLES = { men: "Men Perfumes", women: "Women Perfumes" } as const;

export type CatalogGender = keyof typeof CATALOG_TITLES;

export function isCatalogGender(value: string): value is CatalogGender {
  return Object.hasOwn(CATALOG_TITLES, value);
}

export const CATALOG_SORTS = ["newest", "price_asc", "price_desc"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const DEFAULT_CATALOG_SORT: CatalogSort = "newest";

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

export const CATALOG_PAGE_SIZE = 12;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional()
    .catch(undefined);

const catalogSearchSchema = z.object({
  fragrance_family: optionalText(100),
  brand: optionalText(255),
  sort: z.enum(CATALOG_SORTS).catch(DEFAULT_CATALOG_SORT),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export interface CatalogSearch {
  fragranceFamily?: string;
  brand?: string;
  sort: CatalogSort;
  page: number;
}

/** Reads the catalog filters from a URL's search params. */
export function parseCatalogSearch(params: URLSearchParams): CatalogSearch {
  const parsed = catalogSearchSchema.parse({
    fragrance_family: params.get("fragrance_family") ?? undefined,
    brand: params.get("brand") ?? undefined,
    sort: params.get("sort") ?? undefined,
    page: params.get("page") ?? undefined,
  });
  return {
    fragranceFamily: parsed.fragrance_family,
    brand: parsed.brand,
    sort: parsed.sort,
    page: parsed.page,
  };
}

/** Whether the shopper narrowed or re-sorted the catalog (a `search` analytics event, #18). */
export function hasActiveFilters(search: CatalogSearch): boolean {
  return Boolean(search.fragranceFamily || search.brand || search.sort !== DEFAULT_CATALOG_SORT);
}

/** Link to `page` of the catalog at `pathname`, keeping the filters and omitting defaults. */
export function catalogHref(pathname: string, search: CatalogSearch, page: number): string {
  const params = new URLSearchParams();
  if (search.fragranceFamily) params.set("fragrance_family", search.fragranceFamily);
  if (search.brand) params.set("brand", search.brand);
  if (search.sort !== DEFAULT_CATALOG_SORT) params.set("sort", search.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
