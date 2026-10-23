import { Form, Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import {
  CATALOG_SORT_LABELS,
  CATALOG_SORTS,
  type CatalogSearch,
  hasActiveFilters,
} from "~/lib/catalog";
import type { CatalogFilterOptions } from "~/lib/products";

export interface CatalogFiltersProps {
  pathname: string;
  search: CatalogSearch;
  options: CatalogFilterOptions;
}

// The muted border keeps the 3:1 boundary contrast that `line` lacks (docs/design.md).
const selectClasses = `min-h-11 w-full rounded-pill border border-muted bg-white px-4 text-base text-ink ${focusRing("onLight")}`;

/**
 * A plain GET form, so filters live in the URL and work without JS. It doesn't send `page`, so
 * changing a filter goes back to the first page.
 */
export function CatalogFilters({ pathname, search, options }: CatalogFiltersProps) {
  return (
    <Form
      method="get"
      action={pathname}
      // Re-mount after navigation so the selects show the URL's values.
      key={JSON.stringify(search)}
      aria-label="Filter and sort"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
    >
      <label className="grid gap-1 text-sm font-bold text-ink">
        Fragrance family
        <select
          name="fragrance_family"
          defaultValue={search.fragranceFamily ?? ""}
          className={selectClasses}
        >
          <option value="">All families</option>
          {options.fragranceFamilies.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-bold text-ink">
        Brand
        <select name="brand" defaultValue={search.brand ?? ""} className={selectClasses}>
          <option value="">All brands</option>
          {options.brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-bold text-ink">
        Sort by
        <select name="sort" defaultValue={search.sort} className={selectClasses}>
          {CATALOG_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {CATALOG_SORT_LABELS[sort]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">Apply</Button>
        {hasActiveFilters(search) && (
          <Link
            to={pathname}
            className={`rounded-pill text-sm font-bold text-primary-dark underline ${focusRing("onLight")}`}
          >
            Reset
          </Link>
        )}
      </div>
    </Form>
  );
}
