// Gift cards (#125): buying one, checking a code and what the buyer sees.
//
// A card is created `pending` with its code, paid like a card order (`startGiftCardPayment` in
// `services/payments.ts`) and activated by the payment callback, which queues the code emails.
// Checkout takes amounts off it inside the order transaction (`services/orders.ts`). The database
// is injectable for tests.
import { randomInt } from "node:crypto";
import type { GiftCard } from "~/lib/commerce";
import {
  GIFT_CARD_CODE_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  type GiftCardAmount,
  type GiftCardRefusal,
  type GiftCardView,
} from "~/lib/gift-cards";
import type { Locale } from "~/lib/i18n";
import { toKopiyky } from "~/lib/money";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import { findGiftCard, insertGiftCard, listUserGiftCards } from "../db/queries/gift-cards";
import { getEnv } from "../env";
import { getMailTransport } from "../mail";
import { deliverOrderEmails, type OrderEmailReport, orderEmailDeps } from "./order-email";

/** A new random code: 16 symbols of Crockford's base 32, 80 bits from the system's CSPRNG. */
export function generateGiftCardCode(random: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < GIFT_CARD_CODE_LENGTH; i += 1) {
    code += GIFT_CARD_CODE_ALPHABET[random(GIFT_CARD_CODE_ALPHABET.length)];
  }
  return code;
}

/** New codes to try before giving up; a clash among 2⁸⁰ codes is already vanishingly rare. */
const CODE_ATTEMPTS = 5;

export interface CreateGiftCardInput {
  amount: GiftCardAmount;
  /** Where the code is sent. */
  email: string;
  /** Who the card is for; the code is sent there too. Dropped when it's the buyer's own. */
  recipientEmail?: string;
  /** `null` for guests. */
  userId: number | null;
  /** The language of the purchase, for the emails. */
  locale: Locale;
}

/** Creates a `pending` card with a fresh code and returns its id. */
export async function createGiftCard(
  { amount, email, recipientEmail, userId, locale }: CreateGiftCardInput,
  {
    db = defaultDb,
    generateCode = generateGiftCardCode,
  }: { db?: Db; generateCode?: () => string } = {},
): Promise<number> {
  const recipient =
    recipientEmail && recipientEmail.toLowerCase() !== email.toLowerCase() ? recipientEmail : null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertGiftCard(db, {
        code: generateCode(),
        initialAmount: `${amount}.00`,
        buyerUserId: userId,
        buyerEmail: email,
        recipientEmail: recipient,
        locale,
      });
    } catch (error) {
      if (pgErrorCode(error) !== UNIQUE_VIOLATION || attempt >= CODE_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/**
 * Why the card can't pay for an order `now`, or `null` when it can. Pure: the caller loads (and,
 * at checkout, locks) the card.
 */
export function checkGiftCard(
  card: Pick<GiftCard, "status" | "balance" | "expiresAt"> | undefined,
  now: Date,
): GiftCardRefusal | null {
  if (!card) return "unknown";
  if (card.status === "pending") return "not-active";
  if (card.status === "expired" || (card.expiresAt !== null && card.expiresAt <= now)) {
    return "expired";
  }
  if (card.status === "used_up" || toKopiyky(card.balance) === 0) return "used-up";
  return null;
}

/** What a card with `balance` pays of an order costing `total`, in whole kopiyky. */
export function giftCardAmountFor(total: number, balance: number): number {
  return Math.max(0, Math.min(total, balance));
}

/** Who is asking to see a card: the logged-in user and the cards bought in this browser. */
export interface GiftCardViewer {
  userId: number | null;
  /** From the cookie session (`SessionData.giftCardIds`). */
  giftCardIds: readonly number[];
}

/** The buyer sees their card: as the logged-in user who bought it, or in the browser it was bought in. */
export function canViewGiftCard(
  card: Pick<GiftCard, "id" | "buyerUserId">,
  viewer: GiftCardViewer,
): boolean {
  return (
    (card.buyerUserId !== null && card.buyerUserId === viewer.userId) ||
    viewer.giftCardIds.includes(card.id)
  );
}

/**
 * The card as its buyer sees it; the code only once it's paid (#125, Q3). An active card past its
 * date reads as `expired` before the expiry job has marked it.
 */
export function toGiftCardView(card: GiftCard, now: Date = new Date()): GiftCardView {
  const expired = card.status === "active" && card.expiresAt !== null && card.expiresAt <= now;
  return {
    id: card.id,
    status: expired ? "expired" : card.status,
    initialAmount: card.initialAmount,
    balance: card.balance,
    code: card.status === "pending" ? null : card.code,
    buyerEmail: card.buyerEmail,
    recipientEmail: card.recipientEmail,
    createdAt: card.createdAt,
    expiresAt: card.expiresAt,
  };
}

/** The card for its result page, or `undefined` when it doesn't exist or isn't the viewer's. */
export async function getGiftCardView(
  id: number,
  viewer: GiftCardViewer,
  db: Db = defaultDb,
): Promise<GiftCardView | undefined> {
  const card = await findGiftCard(db, id);
  return card && canViewGiftCard(card, viewer) ? toGiftCardView(card) : undefined;
}

/** The cards the user bought, newest first, for `/account`. */
export async function getAccountGiftCards(
  userId: number,
  db: Db = defaultDb,
): Promise<GiftCardView[]> {
  return (await listUserGiftCards(db, userId)).map((card) => toGiftCardView(card));
}

/**
 * The first attempt at sending a paid card's code emails, right after the payment callback
 * committed. Never rejects; `pnpm db:send-order-emails` retries a failure.
 */
export function deliverGiftCardEmails(
  giftCardId: number,
  db: Db = defaultDb,
): Promise<OrderEmailReport> {
  return deliverOrderEmails({ giftCardId }, () => orderEmailDeps(db, getMailTransport(), getEnv()));
}
