// Parses the catalog's search params with zod. Imported only by the catalog `loader` and tests, so
// zod stays out of the client bundle (#96).
import { z } from "zod";
import { CATALOG_SORTS, type CatalogSearch, DEFAULT_CATALOG_SORT } from "./catalog";

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
