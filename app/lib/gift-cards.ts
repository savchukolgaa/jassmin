// Gift cards (#125): the amounts, the code format and the shapes the pages show. Isomorphic: no
// server imports and no zod (the form schemas are in `gift-cards.schema.ts`).
import type { GiftCardStatus } from "./enums";
import type { TextKey } from "./i18n";
import { fromKopiyky, toKopiyky } from "./money";

/** The only amounts a gift card is sold in, in hryvnias. */
export const GIFT_CARD_AMOUNTS = [500, 1000, 2000] as const;

export type GiftCardAmount = (typeof GIFT_CARD_AMOUNTS)[number];

export function isGiftCardAmount(value: number): value is GiftCardAmount {
  return (GIFT_CARD_AMOUNTS as readonly number[]).includes(value);
}

/** A card is valid for this many months from its payment. */
export const GIFT_CARD_VALIDITY_MONTHS = 12;

/**
 * The symbols a code is drawn from: Crockford's base 32 (digits and capitals without `I`, `L`,
 * `O` and `U`), so no two symbols look alike and 16 of them carry 80 random bits.
 */
export const GIFT_CARD_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const GIFT_CARD_CODE_LENGTH = 16;

/** The longest input a code field takes: the code with a separator every four symbols, padded. */
export const MAX_GIFT_CARD_CODE_INPUT = 40;

/**
 * A typed code as stored: uppercase without spaces or dashes, with the look-alikes `O`, `I` and
 * `L` read as `0` and `1` (Crockford). `null` when it can't be a code, so no lookup is made.
 */
export function normalizeGiftCardCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (code.length !== GIFT_CARD_CODE_LENGTH) return null;
  for (const symbol of code) {
    if (!GIFT_CARD_CODE_ALPHABET.includes(symbol)) return null;
  }
  return code;
}

/** A stored code as shown and emailed: `XXXX-XXXX-XXXX-XXXX`. */
export function formatGiftCardCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Only the last four symbols, for the checkout summary: `••••-••••-••••-WXYZ`. */
export function maskGiftCardCode(code: string): string {
  return `••••-••••-••••-${code.slice(-4)}`;
}

/** The largest `gift_cards.id` (a PostgreSQL `integer`, serial). */
const MAX_GIFT_CARD_ID = 2_147_483_647;

/** A gift card id from a route param, or `null` when it can't be one. */
export function parseGiftCardId(param: string | undefined): number | null {
  if (param === undefined || !/^\d{1,10}$/.test(param)) return null;
  const id = Number(param);
  return id > 0 && id <= MAX_GIFT_CARD_ID ? id : null;
}

/** Why a code can't be used at checkout. */
export type GiftCardRefusal = "unknown" | "not-active" | "expired" | "used-up";

/** The message for each refusal, and for too many tries. */
export const GIFT_CARD_ERROR_KEYS = {
  unknown: "checkout.giftCard.errors.unknown",
  "not-active": "checkout.giftCard.errors.notActive",
  expired: "checkout.giftCard.errors.expired",
  "used-up": "checkout.giftCard.errors.usedUp",
  "too-many-attempts": "checkout.giftCard.errors.tooManyAttempts",
} as const satisfies Record<GiftCardRefusal | "too-many-attempts", TextKey>;

/** The status pill's label for each state. */
export const GIFT_CARD_STATUS_KEYS = {
  pending: "giftCards.status.pending",
  active: "giftCards.status.active",
  used_up: "giftCards.status.usedUp",
  expired: "giftCards.status.expired",
} as const satisfies Record<GiftCardStatus, TextKey>;

/**
 * Where the card's purchase payment stands, for its result page: `paid` (active, used up or
 * expired), or `pending` / `failed` while it's still unpaid. The last two can start a new attempt.
 */
export type GiftCardPaymentView = "paid" | "pending" | "failed";

/** A card as its buyer sees it on its result page and on `/account`. Amounts are decimals. */
export interface GiftCardView {
  id: number;
  status: GiftCardStatus;
  initialAmount: string;
  balance: string;
  /** Shown only once the card is paid; `null` while it's pending. */
  code: string | null;
  buyerEmail: string;
  recipientEmail: string | null;
  createdAt: Date;
  /** `null` until the card is paid. */
  expiresAt: Date | null;
}

/** The card applied to the checkout's cart, as the summary shows it. */
export interface CheckoutGiftCard {
  /** `maskGiftCardCode`. */
  maskedCode: string;
  /** What it takes off this order: at most the order's total. */
  amount: string;
  /** What's left on the card after this order. */
  balanceAfter: string;
}

/** The checkout's gift card intents; anything else posted to `/checkout` places the order. */
export const GIFT_CARD_INTENTS = ["apply-gift-card", "remove-gift-card"] as const;

export type GiftCardIntent = (typeof GIFT_CARD_INTENTS)[number];

export function isGiftCardIntent(value: unknown): value is GiftCardIntent {
  return (GIFT_CARD_INTENTS as readonly unknown[]).includes(value);
}

/** The gift card form's fetcher key, shared with the checkout page that shows its result. */
export const CHECKOUT_GIFT_CARD_FETCHER = "checkout-gift-card";

/**
 * The checkout action's answer to a gift card intent: the card and what is left to pay, so the
 * page updates without reloading its loader (which would record `checkout_start` again), or the
 * message for a refused code.
 */
export type CheckoutGiftCardResult =
  | { ok: true; giftCard: CheckoutGiftCard | null; amountDue: string }
  | { ok: false; error: TextKey };

/** What is left to pay of `total` after the gift card, as a decimal string. */
export function amountDueAfter(total: string, giftCard: CheckoutGiftCard | null): string {
  return giftCard ? fromKopiyky(toKopiyky(total) - toKopiyky(giftCard.amount)) : total;
}
