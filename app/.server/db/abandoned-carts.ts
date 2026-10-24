// `pnpm db:mark-abandoned-carts`: marks inactive carts as abandoned (#19). Run it hourly from an
// external scheduler; the CLI wrapper is scripts/mark-abandoned-carts.ts.
import { z } from "zod";
import type { Db } from "./client";
import { markAbandonedCarts } from "./queries/cart";

export const DEFAULT_ABANDONED_CART_HOURS = 24;

// Whole hours, because `make_interval(hours => …)` takes an int.
const hoursSchema = z.coerce.number().int().positive().default(DEFAULT_ABANDONED_CART_HOURS);

/** Reads `ABANDONED_CART_HOURS` (default 24); an empty value counts as unset. */
export function parseAbandonedCartHours(
  source: NodeJS.ProcessEnv,
): { ok: true; hours: number } | { ok: false; error: string } {
  const result = hoursSchema.safeParse(source.ABANDONED_CART_HOURS || undefined);
  if (!result.success) {
    return {
      ok: false,
      error: `ABANDONED_CART_HOURS must be a positive whole number of hours, got "${source.ABANDONED_CART_HOURS}".`,
    };
  }
  return { ok: true, hours: result.data };
}

/** Runs the job; returns how many carts it marked and the message to log. */
export async function markAbandonedCartsJob(
  db: Db,
  hours: number,
): Promise<{ updated: number; message: string }> {
  const updated = await markAbandonedCarts(db, hours);
  const carts = updated === 1 ? "cart" : "carts";
  return {
    updated,
    message: `Marked ${updated} ${carts} inactive for more than ${hours} h as abandoned.`,
  };
}
