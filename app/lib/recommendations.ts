// Product recommendations (#182): item-item cosine on co-purchases and co-views, computed nightly
// by `pnpm db:build-recommendations`. Isomorphic: no server imports.

/** How many recommendations the job keeps per product. */
export const RECOMMENDATIONS_PER_PRODUCT = 12;

/** How many recommended perfumes a page shows: one row of the 4-wide grid. */
export const RECS_LIST_LIMIT = 4;
