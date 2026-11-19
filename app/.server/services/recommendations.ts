// "Customers also chose", "For you" and "Complete your trio" (#182): the nightly item-item cosine
// recommendations (`product_recommendations`), with the fallback chain while there's too little
// data: the family-based similar perfumes, then the bestsellers. Every list shows only listed,
// in-stock single perfumes, never the product itself or one already in the cart.
import type { CartView } from "~/lib/cart";
import { GENDERS } from "~/lib/enums";
import type { ProductDetail, ProductSummary } from "~/lib/products";
import { type ProductRecsSource, pendingTrioUnits, RECS_LIST_LIMIT } from "~/lib/recommendations";
import type { TrioOffer } from "~/lib/trio";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import {
  findProductIdsByPublicIds,
  listBestsellers,
  listRecommendedProducts,
  listSimilarProducts,
  type ProductSummaryRow,
  type RecommendableFilter,
} from "../db/queries/products";
import {
  listPurchasedProductIds,
  listRecentlyViewedProductIds,
} from "../db/queries/recommendations";
import { GENDER_SCOPE, toSummary } from "./products";

/** How many recent views and purchases seed "For you". */
export const FOR_YOU_SEEDS = 5;

type Source = (filter: RecommendableFilter, limit: number) => Promise<ProductSummaryRow[]>;

/**
 * Up to `limit` products from `sources` in order, each source asked only for what's still
 * missing and without the products earlier sources gave.
 */
export async function fillUp(
  filter: RecommendableFilter,
  limit: number,
  sources: readonly Source[],
): Promise<ProductSummaryRow[]> {
  const rows: ProductSummaryRow[] = [];
  for (const source of sources) {
    const missing = limit - rows.length;
    if (missing <= 0) {
      break;
    }
    const exclude = [...(filter.excludePublicIds ?? []), ...rows.map((row) => row.publicId)];
    const seen = new Set(exclude);
    for (const row of await source({ ...filter, excludePublicIds: exclude }, missing)) {
      if (!seen.has(row.publicId) && rows.length < limit) {
        seen.add(row.publicId);
        rows.push(row);
      }
    }
  }
  return rows;
}

const bestsellers =
  (db: Db): Source =>
  (filter, limit) =>
    listBestsellers(db, limit, filter);

export interface ProductRecs {
  source: ProductRecsSource;
  products: ProductSummary[];
}

/**
 * A product page's list: "Customers also chose" when the product has recommendations, topped up
 * with similar perfumes; otherwise the similar perfumes by family, brand and popularity (#88),
 * then the bestsellers.
 */
export async function forProduct(
  productId: number,
  product: Pick<ProductDetail, "id" | "gender" | "fragranceFamilies" | "brand">,
  { cartProductIds = [] }: { cartProductIds?: readonly string[] } = {},
  db: Db = defaultDb,
): Promise<ProductRecs> {
  const filter: RecommendableFilter = { excludePublicIds: [product.id, ...cartProductIds] };
  const similar: Source = (sourceFilter, limit) =>
    listSimilarProducts(db, {
      excludeId: productId,
      genders: product.gender === "unisex" ? GENDERS : GENDER_SCOPE[product.gender],
      fragranceFamilies: product.fragranceFamilies,
      brand: product.brand,
      limit,
      filter: sourceFilter,
    });
  const recs = await listRecommendedProducts(db, {
    ...filter,
    seedIds: [productId],
    limit: RECS_LIST_LIMIT,
  });
  const rows = await fillUp(filter, RECS_LIST_LIMIT, [async () => recs, similar, bestsellers(db)]);
  return { source: recs.length > 0 ? "recs" : "similar", products: rows.map(toSummary) };
}

export interface VisitorHistory {
  userId: number | null;
  anonymousId: string | null;
  /** Whether views may be read: the visitor accepted cookies (#18). */
  trackingAllowed: boolean;
  cartProductIds?: readonly string[];
}

/**
 * The home page's "For you": recommendations blended from the visitor's latest views (with
 * consent) and a logged-in customer's latest orders, without what they ordered or have in the
 * cart. `null` without history or without recommendations for it, so the page shows only the
 * bestsellers.
 */
export async function forVisitor(
  { userId, anonymousId, trackingAllowed, cartProductIds = [] }: VisitorHistory,
  db: Db = defaultDb,
): Promise<ProductSummary[] | null> {
  const [viewed, purchased] = await Promise.all([
    trackingAllowed
      ? listRecentlyViewedProductIds(db, { userId, anonymousId, limit: FOR_YOU_SEEDS })
      : Promise.resolve([]),
    userId === null ? Promise.resolve([]) : listPurchasedProductIds(db, userId),
  ]);
  const seedIds = [...new Set([...viewed, ...purchased.slice(0, FOR_YOU_SEEDS)])];
  if (seedIds.length === 0) {
    return null;
  }
  const filter: RecommendableFilter = { excludePublicIds: cartProductIds, excludeIds: purchased };
  const recs = await listRecommendedProducts(db, { ...filter, seedIds, limit: RECS_LIST_LIMIT });
  if (recs.length === 0) {
    return null;
  }
  const rows = await fillUp(filter, RECS_LIST_LIMIT, [async () => recs, bestsellers(db)]);
  return rows.map(toSummary);
}

export interface CartRecs {
  /** Testers still missing from the next trio; 0 hides the list. */
  missing: number;
  products: ProductSummary[];
}

/**
 * The cart's "Complete your trio": while the cart's testers don't fill a whole tester trio,
 * perfumes with the trio's size in stock, recommended for what's in the cart, then the
 * bestsellers. Each card preselects the trio's size.
 */
export async function forCart(
  cart: Pick<CartView, "lines">,
  offer: TrioOffer | null,
  db: Db = defaultDb,
): Promise<CartRecs> {
  const missing = pendingTrioUnits(cart.lines, offer);
  if (!offer || missing === 0) {
    return { missing: 0, products: [] };
  }
  const cartProductIds = [...new Set(cart.lines.map((line) => line.productId))];
  const seedIds = await findProductIdsByPublicIds(db, cartProductIds);
  const filter: RecommendableFilter = {
    excludePublicIds: cartProductIds,
    volumeMl: offer.volumeMl,
  };
  const rows = await fillUp(filter, RECS_LIST_LIMIT, [
    (sourceFilter, limit) => listRecommendedProducts(db, { ...sourceFilter, seedIds, limit }),
    bestsellers(db),
  ]);
  return {
    missing,
    products: rows.map((row) => preselectVolume(toSummary(row), offer.volumeMl)),
  };
}

/** The card's add button adds the `volumeMl` size when the product has it in stock. */
export function preselectVolume(product: ProductSummary, volumeMl: number | null): ProductSummary {
  const variant = product.variants.find((v) => v.volumeMl === volumeMl && v.inStock);
  return variant
    ? { ...product, defaultVariant: { id: variant.id, volumeMl: variant.volumeMl } }
    : product;
}
