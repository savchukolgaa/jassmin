// `pnpm db:expire-gift-cards`: marks active gift cards whose 12 months are over as `expired`
// (#125) and queues them for Strapi, in one transaction. Run it daily from an external scheduler;
// the CLI wrapper is scripts/expire-gift-cards.ts. Checkout compares `expires_at` itself, so a
// card can't be spent after its date even before this job runs: it keeps Strapi and analytics
// right.
import type { Db } from "./client";
import { enqueueCmsSync } from "./queries/cms-outbox";
import { markExpiredGiftCards } from "./queries/gift-cards";

/** Runs the job; returns the cards it marked and the message to log. */
export async function expireGiftCardsJob(
  db: Db,
  now: Date = new Date(),
): Promise<{ expired: number[]; message: string }> {
  const expired = await db.transaction(async (tx) => {
    const ids = await markExpiredGiftCards(tx, now);
    await enqueueCmsSync(tx, "gift_card", ids);
    return ids;
  });
  const cards = expired.length === 1 ? "gift card" : "gift cards";
  return { expired, message: `Marked ${expired.length} ${cards} past their date as expired.` };
}
