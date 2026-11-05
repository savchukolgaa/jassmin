// Gift cards (#125). The services run the writes inside one transaction per change: checkout locks
// the card (`findGiftCard` with `lock`) before it takes an amount, so two orders can never spend
// more than the balance; `gift_cards_balance_check` is the backstop.
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { GiftCard, GiftCardRedemption } from "~/lib/commerce";
import { GIFT_CARD_VALIDITY_MONTHS } from "~/lib/gift-cards";
import type { Locale } from "~/lib/i18n";
import type { Db } from "../client";
import { giftCardRedemptions, giftCards } from "../schema";

/** A `Db` or a transaction, so the services can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update">;

export interface NewGiftCard {
  code: string;
  /** One of `GIFT_CARD_AMOUNTS`, as a decimal string. */
  initialAmount: string;
  buyerUserId: number | null;
  buyerEmail: string;
  recipientEmail: string | null;
  locale: Locale;
}

/** Inserts a `pending` card with its full balance and returns its id. A taken code is `23505`. */
export async function insertGiftCard(db: Executor, card: NewGiftCard): Promise<number> {
  const [row] = await db
    .insert(giftCards)
    .values({ ...card, balance: card.initialAmount })
    .returning({ id: giftCards.id });
  if (!row) {
    throw new Error("Could not insert the gift card");
  }
  return row.id;
}

/** The card, or `undefined`; `lock` takes the row `FOR UPDATE`. */
export async function findGiftCard(
  db: Executor,
  id: number,
  { lock = false }: { lock?: boolean } = {},
): Promise<GiftCard | undefined> {
  const query = db.select().from(giftCards).where(eq(giftCards.id, id));
  const [row] = await (lock ? query.for("update") : query);
  return row;
}

/** The card with this code (normalized, `normalizeGiftCardCode`), or `undefined`. */
export async function findGiftCardByCode(
  db: Executor,
  code: string,
): Promise<GiftCard | undefined> {
  const [row] = await db.select().from(giftCards).where(eq(giftCards.code, code));
  return row;
}

/**
 * Activates a `pending` card paid by `paymentId`: its 12 months start `now`. Returns the card when
 * it changed, `undefined` when it wasn't pending (a repeated callback changes nothing).
 */
export async function activateGiftCard(
  db: Executor,
  id: number,
  { paymentId, now }: { paymentId: number; now: Date },
): Promise<GiftCard | undefined> {
  const [row] = await db
    .update(giftCards)
    .set({
      status: "active",
      paymentId,
      activatedAt: now,
      expiresAt: sql`${now.toISOString()}::timestamptz + make_interval(months => ${GIFT_CARD_VALIDITY_MONTHS})`,
    })
    .where(and(eq(giftCards.id, id), eq(giftCards.status, "pending")))
    .returning();
  return row;
}

/**
 * Takes `amount` off the card for the order and records it. The card must be locked and checked
 * by the caller; a balance that would go below 0 fails `gift_cards_balance_check`. A card spent
 * down to 0 is `used_up`.
 */
export async function redeemGiftCard(
  db: Executor,
  { giftCardId, orderId, amount }: { giftCardId: number; orderId: number; amount: string },
): Promise<void> {
  await db.insert(giftCardRedemptions).values({ giftCardId, orderId, amount });
  const left = sql`${giftCards.balance} - ${amount}::numeric`;
  await db
    .update(giftCards)
    .set({
      balance: sql`${left}`,
      status: sql`case when ${left} = 0 then 'used_up' else ${giftCards.status} end`,
    })
    .where(eq(giftCards.id, giftCardId));
}

/**
 * Gives an order's redemptions back to their cards, once (#125, Q2): sets `reversed_at`, adds the
 * amount back to the balance and makes a used-up card `active` again unless it has expired.
 * Returns the cards that changed, for Strapi. The cards are locked in id order, like checkout.
 */
export async function restoreGiftCardRedemptions(
  db: Executor,
  orderId: number,
  now: Date,
): Promise<number[]> {
  const redemptions = await db
    .select({ id: giftCardRedemptions.id, giftCardId: giftCardRedemptions.giftCardId })
    .from(giftCardRedemptions)
    .where(and(eq(giftCardRedemptions.orderId, orderId), isNull(giftCardRedemptions.reversedAt)))
    .orderBy(asc(giftCardRedemptions.giftCardId));
  if (redemptions.length === 0) return [];

  const cardIds = [...new Set(redemptions.map((r) => r.giftCardId))];
  await db
    .select({ id: giftCards.id })
    .from(giftCards)
    .where(inArray(giftCards.id, cardIds))
    .orderBy(asc(giftCards.id))
    .for("update");

  const reversed = await db
    .update(giftCardRedemptions)
    .set({ reversedAt: now })
    .where(
      and(
        inArray(
          giftCardRedemptions.id,
          redemptions.map((r) => r.id),
        ),
        isNull(giftCardRedemptions.reversedAt),
      ),
    )
    .returning({ giftCardId: giftCardRedemptions.giftCardId, amount: giftCardRedemptions.amount });
  for (const { giftCardId, amount } of reversed) {
    await db
      .update(giftCards)
      .set({
        balance: sql`${giftCards.balance} + ${amount}::numeric`,
        status: sql`case when ${giftCards.status} = 'used_up' and ${giftCards.expiresAt} > ${now.toISOString()}::timestamptz then 'active' else ${giftCards.status} end`,
      })
      .where(eq(giftCards.id, giftCardId));
  }
  return cardIds;
}

/** The cards a user bought, newest first, for `/account`. */
export function listUserGiftCards(db: Executor, userId: number): Promise<GiftCard[]> {
  return db
    .select()
    .from(giftCards)
    .where(eq(giftCards.buyerUserId, userId))
    .orderBy(desc(giftCards.createdAt), desc(giftCards.id));
}

/** Marks `active` cards whose 12 months are over as `expired` and returns their ids. */
export async function markExpiredGiftCards(db: Executor, now: Date): Promise<number[]> {
  const rows = await db
    .update(giftCards)
    .set({ status: "expired" })
    .where(and(eq(giftCards.status, "active"), lte(giftCards.expiresAt, now)))
    .returning({ id: giftCards.id });
  return rows.map((row) => row.id);
}

/** The card and its redemptions, for the push to Strapi. */
export async function findGiftCardSyncState(
  db: Executor,
  id: number,
): Promise<{ card: GiftCard; redemptions: GiftCardRedemption[] } | undefined> {
  const card = await findGiftCard(db, id);
  if (!card) return undefined;
  const redemptions = await db
    .select()
    .from(giftCardRedemptions)
    .where(eq(giftCardRedemptions.giftCardId, id))
    .orderBy(asc(giftCardRedemptions.id));
  return { card, redemptions };
}

export type GiftCardSyncRow = NonNullable<Awaited<ReturnType<typeof findGiftCardSyncState>>>;
