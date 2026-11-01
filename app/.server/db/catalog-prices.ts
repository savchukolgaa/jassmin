import type { PerfumeVolumeMl } from "~/lib/enums";

/** A price in UAH per size, as a `numeric(10, 2)` string; only the sizes listed are sold. */
export type CatalogPrices = Partial<Record<PerfumeVolumeMl, string>>;

/**
 * The owner's price table for every perfume in the catalog (#66, set on 2026-10-26): the same
 * sizes at the same price per size. `pnpm db:import-catalog` creates these sizes for each perfume
 * it adds; prices staff change later in Strapi are never overwritten.
 */
export const CATALOG_PRICES: CatalogPrices = {
  5: "119.00",
  10: "240.00",
  30: "459.00",
  50: "629.00",
  100: "969.00",
};
