// `pnpm db:prune-rate-limits` (#143): deletes the `rate_limits` rows whose window has ended. They
// are harmless (the next hit restarts the window), so this only keeps the table small. Run it
// daily from an external scheduler; the CLI wrapper is scripts/prune-rate-limits.ts.
import type { Db } from "./client";
import { pruneRateLimits } from "./queries/rate-limits";

/** Runs the job; returns how many rows it deleted and the message to log. */
export async function pruneRateLimitsJob(
  db: Db,
  now: Date = new Date(),
): Promise<{ deleted: number; message: string }> {
  const deleted = await pruneRateLimits(db, now);
  const rows = deleted === 1 ? "rate limit window" : "rate limit windows";
  return { deleted, message: `Deleted ${deleted} ended ${rows}.` };
}
