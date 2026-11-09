// The real catalog as the synthetic data generator (#131) reads it: `analytics/generator/` is
// Python and can't import TypeScript, so `pnpm analytics:export-catalog` writes this object to
// `analytics/generator/data/catalog.json`, and `synthetic-catalog.test.ts` fails when that file is
// stale.
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { FRAGRANCE_FAMILIES, type Gender, PERFUME_VOLUMES_ML } from "~/lib/enums";
import { CATALOG_PRODUCTS } from "./catalog-data";
import { CATALOG_PRICES } from "./catalog-prices";

/** Where the exported catalog lives, relative to the repo root. */
export const SYNTHETIC_CATALOG_PATH = "analytics/generator/data/catalog.json";

export interface SyntheticCatalogProduct {
  publicId: string;
  title: string;
  brand: string;
  gender: Gender;
  storeCode: string;
  /** Primary first. */
  fragranceFamilies: string[];
  popularRank: number | null;
}

export interface SyntheticCatalog {
  products: SyntheticCatalogProduct[];
  /** UAH per size, as `numeric(10, 2)` strings, keyed by the volume in ml. */
  prices: Record<string, string>;
  volumesMl: number[];
  fragranceFamilies: string[];
  freeShippingThreshold: string;
}

export function buildSyntheticCatalog(): SyntheticCatalog {
  const prices: Record<string, string> = {};
  for (const volume of PERFUME_VOLUMES_ML) {
    const price = CATALOG_PRICES[volume];
    if (price !== undefined) prices[String(volume)] = price;
  }
  return {
    products: CATALOG_PRODUCTS.map((p) => ({
      publicId: p.publicId,
      title: p.title,
      brand: p.brand,
      gender: p.gender,
      storeCode: p.storeCode,
      fragranceFamilies: [...p.fragranceFamilies],
      popularRank: p.popularRank,
    })),
    prices,
    volumesMl: [...PERFUME_VOLUMES_ML],
    fragranceFamilies: [...FRAGRANCE_FAMILIES],
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
  };
}

/** The file's exact text: two-space JSON with a trailing newline. */
export function renderSyntheticCatalog(
  catalog: SyntheticCatalog = buildSyntheticCatalog(),
): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
