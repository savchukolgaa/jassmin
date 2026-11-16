import { asc, gt } from "drizzle-orm";
import type { Gender } from "~/lib/enums";
import type { Db } from "../client";
import { products, productVariants } from "../schema";
import { variantStock } from "./products";

/** A product as the AI perfumer's tools see it (#162). */
export interface PerfumerProductRow {
  publicId: string;
  title: string;
  brand: string;
  gender: Gender;
  /** Primary first (#65). */
  fragranceFamilies: string[];
  notes: string[];
  popularRank: number | null;
  active: boolean;
  /** The sizes in stock (#98), smallest first; `price` is the exact decimal string. */
  sizes: { ml: number; price: string }[];
}

/**
 * Every product with its sizes in stock, archived ones included: `similar_to` may start from an
 * archived favourite, and the prose guard needs every title and brand. The catalog is small
 * (~130 products), so the tools filter and rank in TypeScript. Two plain queries joined here
 * rather than a correlated subquery: Drizzle leaves the table name off columns in a single-table
 * select, which made such a subquery compare the variant's own columns.
 */
export async function listPerfumerProducts(db: Db): Promise<PerfumerProductRow[]> {
  const [productRows, sizeRows] = await Promise.all([
    db
      .select({
        id: products.id,
        publicId: products.publicId,
        title: products.title,
        brand: products.brand,
        gender: products.gender,
        fragranceFamilies: products.fragranceFamilies,
        notes: products.notes,
        popularRank: products.popularRank,
        active: products.active,
      })
      .from(products)
      .orderBy(asc(products.id)),
    db
      .select({
        productId: productVariants.productId,
        ml: productVariants.volumeMl,
        price: productVariants.price,
      })
      .from(productVariants)
      .where(gt(variantStock, 0))
      .orderBy(asc(productVariants.volumeMl)),
  ]);

  const sizesByProduct = new Map<number, { ml: number; price: string }[]>();
  for (const { productId, ml, price } of sizeRows) {
    const sizes = sizesByProduct.get(productId) ?? [];
    sizes.push({ ml, price });
    sizesByProduct.set(productId, sizes);
  }
  return productRows.map(({ id, ...product }) => ({
    ...product,
    sizes: sizesByProduct.get(id) ?? [],
  }));
}
