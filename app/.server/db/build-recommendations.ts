// `pnpm db:build-recommendations` (#182): item-item cosine recommendations from the shop's own
// orders and consented product views, the method notebook 04 (#133) chose. Run it nightly from
// cron; the CLI wrapper is scripts/build-recommendations.ts.
import { z } from "zod";
import { RECOMMENDATIONS_PER_PRODUCT } from "~/lib/recommendations";
import type { Db } from "./client";
import {
  listRecommendationSignals,
  type NewProductRecommendation,
  type RecommendationSignal,
  replaceRecommendations,
} from "./queries/recommendations";

/** How many baskets a product needs before it gets recommendations (#182). */
export const DEFAULT_RECS_MIN_SIGNALS = 5;

/** Only the last year of orders and views counts. */
export const RECS_WINDOW_DAYS = 365;

const minSignalsSchema = z.coerce.number().int().positive().default(DEFAULT_RECS_MIN_SIGNALS);

/** Reads `RECS_MIN_SIGNALS` (default 5); an empty value counts as unset. */
export function parseMinSignals(
  source: NodeJS.ProcessEnv,
): { ok: true; minSignals: number } | { ok: false; error: string } {
  const result = minSignalsSchema.safeParse(source.RECS_MIN_SIGNALS || undefined);
  if (!result.success) {
    return {
      ok: false,
      error: `RECS_MIN_SIGNALS must be a positive whole number, got "${source.RECS_MIN_SIGNALS}".`,
    };
  }
  return { ok: true, minSignals: result.data };
}

export interface ItemRecommendation {
  productId: number;
  recommendedProductId: number;
  score: number;
  rank: number;
  /** Baskets that hold both products. */
  signals: number;
}

export interface ItemCosineResult {
  rows: ItemRecommendation[];
  /** Products with at least one signal. */
  products: number;
  /** Products with at least `minSignals` baskets, the ones that got recommendations. */
  eligible: number;
}

/**
 * Item-item cosine similarity over baskets: each basket is a vector dimension, and a product's
 * value in it is the basket's weight (once per basket, however often it was bought or viewed).
 * `sim(i, j) = Σ w_i·w_j / (‖i‖·‖j‖)`. Products in at least `minSignals` baskets keep their
 * `topN` most similar products, best first (ties: more shared baskets, then lower id).
 */
export function computeItemCosine(
  signals: readonly RecommendationSignal[],
  { topN = RECOMMENDATIONS_PER_PRODUCT, minSignals = DEFAULT_RECS_MIN_SIGNALS } = {},
): ItemCosineResult {
  // basket → product → weight (deduplicated: the highest weight wins).
  const baskets = new Map<string, Map<number, number>>();
  for (const { basket, productId, weight } of signals) {
    if (weight <= 0) {
      continue;
    }
    const items = baskets.get(basket) ?? new Map<number, number>();
    items.set(productId, Math.max(items.get(productId) ?? 0, weight));
    baskets.set(basket, items);
  }

  const squaredNorm = new Map<number, number>();
  const basketCount = new Map<number, number>();
  // "i:j" (i < j) → dot product and shared baskets.
  const pairs = new Map<string, { dot: number; shared: number }>();
  for (const items of baskets.values()) {
    const entries = [...items].sort(([a], [b]) => a - b);
    for (const [productId, weight] of entries) {
      squaredNorm.set(productId, (squaredNorm.get(productId) ?? 0) + weight * weight);
      basketCount.set(productId, (basketCount.get(productId) ?? 0) + 1);
    }
    for (let a = 0; a < entries.length; a++) {
      const [i, wi] = entries[a] as [number, number];
      for (let b = a + 1; b < entries.length; b++) {
        const [j, wj] = entries[b] as [number, number];
        const key = `${i}:${j}`;
        const pair = pairs.get(key) ?? { dot: 0, shared: 0 };
        pair.dot += wi * wj;
        pair.shared += 1;
        pairs.set(key, pair);
      }
    }
  }

  const eligible = new Set(
    [...basketCount].filter(([, count]) => count >= minSignals).map(([id]) => id),
  );
  const candidates = new Map<number, Omit<ItemRecommendation, "rank">[]>();
  const add = (from: number, to: number, score: number, shared: number) => {
    if (!eligible.has(from)) {
      return;
    }
    const list = candidates.get(from) ?? [];
    list.push({ productId: from, recommendedProductId: to, score, signals: shared });
    candidates.set(from, list);
  };
  for (const [key, { dot, shared }] of pairs) {
    const [i, j] = key.split(":").map(Number) as [number, number];
    const score = dot / Math.sqrt((squaredNorm.get(i) ?? 0) * (squaredNorm.get(j) ?? 0));
    add(i, j, score, shared);
    add(j, i, score, shared);
  }

  const rows: ItemRecommendation[] = [];
  for (const productId of [...candidates.keys()].sort((a, b) => a - b)) {
    const list = candidates.get(productId) ?? [];
    list.sort(
      (a, b) =>
        b.score - a.score ||
        b.signals - a.signals ||
        a.recommendedProductId - b.recommendedProductId,
    );
    list.slice(0, topN).forEach((row, index) => {
      rows.push({ ...row, rank: index + 1 });
    });
  }
  return { rows, products: basketCount.size, eligible: eligible.size };
}

/** Runs the job: reads the last year's signals and replaces the table in one transaction. */
export async function buildRecommendationsJob(
  db: Db,
  { now = new Date(), minSignals = DEFAULT_RECS_MIN_SIGNALS } = {},
): Promise<ItemCosineResult & { message: string }> {
  const since = new Date(now.getTime() - RECS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const signals = await listRecommendationSignals(db, since);
  const result = computeItemCosine(signals, { minSignals });
  const rows: NewProductRecommendation[] = result.rows.map((row) => ({ ...row, computedAt: now }));
  await db.transaction(async (tx) => {
    await replaceRecommendations(tx, rows);
  });
  return {
    ...result,
    message:
      `Recommendations for ${result.eligible} of ${result.products} products with signals ` +
      `(at least ${minSignals} each): ${result.rows.length} rows.`,
  };
}
