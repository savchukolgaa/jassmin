import { asc, sql } from "drizzle-orm";
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
 * (~130 products), so the tools filter and rank in TypeScript.
 */
export function listPerfumerProducts(db: Db): Promise<PerfumerProductRow[]> {
  return db
    .select({
      publicId: products.publicId,
      title: products.title,
      brand: products.brand,
      gender: products.gender,
      fragranceFamilies: products.fragranceFamilies,
      notes: products.notes,
      popularRank: products.popularRank,
      active: products.active,
      sizes: sql<{ ml: number; price: string }[]>`coalesce((
        select json_agg(json_build_object(
          'ml', ${productVariants.volumeMl},
          'price', ${productVariants.price}::text
        ) order by ${productVariants.volumeMl})
        from ${productVariants}
        where ${productVariants.productId} = ${products.id} and ${variantStock} > 0
      ), '[]'::json)`,
    })
    .from(products)
    .orderBy(asc(products.id));
}
