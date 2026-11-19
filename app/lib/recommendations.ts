// Product recommendations (#182): item-item cosine on co-purchases and co-views, computed nightly
// by `pnpm db:build-recommendations`. Isomorphic: no server imports.
import type { CartLine } from "./cart";
import type { TrioOffer } from "./trio";

/** How many recommendations the job keeps per product. */
export const RECOMMENDATIONS_PER_PRODUCT = 12;

/** How many recommended perfumes a page shows: one row of the 4-wide grid. */
export const RECS_LIST_LIMIT = 4;

/**
 * Where a product page's list came from: the nightly recommendations ("Customers also chose"),
 * or the family-based "Similar perfumes" while the product has too few signals.
 */
export type ProductRecsSource = "recs" | "similar";

/**
 * How many more testers the cart needs to complete its next tester trio (#182): 0 when there is
 * no live trio offer, no tester in the cart, or every set is complete. Testers are single
 * (`pack_size 1`) sizes of the offer's volume, any size when the offer names none.
 */
export function pendingTrioUnits(
  lines: readonly Pick<CartLine, "packSize" | "volumeMl" | "quantity">[],
  offer: Pick<TrioOffer, "setSize" | "volumeMl"> | null,
): number {
  if (!offer || offer.setSize < 2) {
    return 0;
  }
  const testers = lines
    .filter(
      (line) =>
        line.packSize === 1 && (offer.volumeMl === null || line.volumeMl === offer.volumeMl),
    )
    .reduce((sum, line) => sum + line.quantity, 0);
  const rest = testers % offer.setSize;
  return rest === 0 ? 0 : offer.setSize - rest;
}
