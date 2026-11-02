// Catalog URL contract: which genders have a catalog page, and the filter/sort/page search params.
// Parsed with zod on the server; invalid values fall back to their defaults so a bad URL never errors.
import { type FragranceFamily, isFragranceFamily } from "./enums";
import type { TextKey, Translator } from "./i18n";

export const CATALOG_GENDERS = ["men", "women"] as const;

export type CatalogGender = (typeof CATALOG_GENDERS)[number];

/** Each catalog's title, e.g. "Жіночі парфуми" / "Women Perfumes". */
export const CATALOG_TITLE_KEYS = {
  men: "catalog.title.men",
  women: "catalog.title.women",
} as const satisfies Record<CatalogGender, TextKey>;

/** Each catalog's `<meta name="description">` (#85). */
export const CATALOG_META_DESCRIPTION_KEYS = {
  men: "catalog.metaDescription.men",
  women: "catalog.metaDescription.women",
} as const satisfies Record<CatalogGender, TextKey>;

export function isCatalogGender(value: string): value is CatalogGender {
  return (CATALOG_GENDERS as readonly string[]).includes(value);
}

export const CATALOG_SORTS = ["newest", "price_asc", "price_desc"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const DEFAULT_CATALOG_SORT: CatalogSort = "newest";

export const CATALOG_SORT_LABEL_KEYS: Record<CatalogSort, TextKey> = {
  newest: "catalog.sort.newest",
  price_asc: "catalog.sort.price_asc",
  price_desc: "catalog.sort.price_desc",
};

/** Each fragrance family's label key; the stored and URL value stays Ukrainian (#65). */
export const FRAGRANCE_FAMILY_LABEL_KEYS = {
  квіткові: "catalog.families.floral",
  фруктові: "catalog.families.fruity",
  східні: "catalog.families.oriental",
  водяні: "catalog.families.aquatic",
  шипрові: "catalog.families.chypre",
  деревні: "catalog.families.woody",
  мускусні: "catalog.families.musky",
  пряні: "catalog.families.spicy",
  гурманські: "catalog.families.gourmand",
  зелені: "catalog.families.green",
  ванільні: "catalog.families.vanilla",
  ароматичні: "catalog.families.aromatic",
  альдегідні: "catalog.families.aldehydic",
  цитрусові: "catalog.families.citrus",
  свіжі: "catalog.families.fresh",
  фужерні: "catalog.families.fougere",
} as const satisfies Record<FragranceFamily, TextKey>;

/** A family's label, or the stored value itself for one outside the list (rows before #65). */
export function fragranceFamilyLabel(value: string, { t }: Pick<Translator, "t">): string {
  return isFragranceFamily(value) ? t(FRAGRANCE_FAMILY_LABEL_KEYS[value]) : value;
}

export const CATALOG_PAGE_SIZE = 12;

export interface CatalogSearch {
  fragranceFamily?: string;
  brand?: string;
  sort: CatalogSort;
  page: number;
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
