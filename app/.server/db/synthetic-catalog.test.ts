import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CATALOG_PRODUCTS } from "./catalog-data";
import {
  buildSyntheticCatalog,
  renderSyntheticCatalog,
  SYNTHETIC_CATALOG_PATH,
} from "./synthetic-catalog";

describe("synthetic catalog export (#131)", () => {
  it("has every perfume and the five standard prices", () => {
    const catalog = buildSyntheticCatalog();
    expect(catalog.products).toHaveLength(CATALOG_PRODUCTS.length);
    expect(catalog.prices).toEqual({
      "5": "119.00",
      "10": "240.00",
      "30": "459.00",
      "50": "629.00",
      "100": "969.00",
    });
    expect(catalog.freeShippingThreshold).toBe("1500.00");
  });

  it("is committed up to date (run `pnpm analytics:export-catalog`)", async () => {
    const committed = await readFile(SYNTHETIC_CATALOG_PATH, "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(renderSyntheticCatalog());
  });
});
