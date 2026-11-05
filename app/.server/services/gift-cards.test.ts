import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GiftCard } from "~/lib/commerce";
import {
  GIFT_CARD_CODE_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  normalizeGiftCardCode,
} from "~/lib/gift-cards";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import {
  canViewGiftCard,
  checkGiftCard,
  generateGiftCardCode,
  giftCardAmountFor,
  toGiftCardView,
} from "./gift-cards";

const NOW = new Date("2026-11-05T10:00:00Z");

const card = (overrides: Partial<GiftCard> = {}): GiftCard => ({
  id: 7,
  code: "ABCDEFGHJKMNPQRS",
  initialAmount: "1000.00",
  balance: "1000.00",
  currency: "UAH",
  status: "active",
  buyerUserId: 3,
  buyerEmail: "buyer@example.com",
  recipientEmail: "friend@example.com",
  locale: "uk",
  paymentId: 1,
  activatedAt: NOW,
  expiresAt: new Date("2027-11-05T10:00:00Z"),
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe("generateGiftCardCode", () => {
  it("draws 16 symbols from the code alphabet, which read back unchanged", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateGiftCardCode();
      expect(code).toHaveLength(GIFT_CARD_CODE_LENGTH);
      for (const symbol of code) expect(GIFT_CARD_CODE_ALPHABET).toContain(symbol);
      expect(normalizeGiftCardCode(code)).toBe(code);
    }
  });

  it("uses every symbol of the alphabet", () => {
    let n = 0;
    expect(generateGiftCardCode(() => n++ % 32)).toBe("0123456789ABCDEF");
    expect(generateGiftCardCode(() => 31)).toBe("ZZZZZZZZZZZZZZZZ");
  });

  it("doesn't repeat itself", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateGiftCardCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("checkGiftCard", () => {
  it("accepts an active card with a balance before its date", () => {
    expect(checkGiftCard(card(), NOW)).toBeNull();
  });

  it("refuses an unknown, unpaid, expired or used-up card", () => {
    expect(checkGiftCard(undefined, NOW)).toBe("unknown");
    expect(checkGiftCard(card({ status: "pending", expiresAt: null }), NOW)).toBe("not-active");
    expect(checkGiftCard(card({ status: "expired" }), NOW)).toBe("expired");
    expect(checkGiftCard(card({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(checkGiftCard(card({ status: "used_up", balance: "0.00" }), NOW)).toBe("used-up");
    expect(checkGiftCard(card({ balance: "0.00" }), NOW)).toBe("used-up");
  });
});

describe("giftCardAmountFor", () => {
  it("pays the whole order when the balance covers it, else the whole balance", () => {
    expect(giftCardAmountFor(60_000, 100_000)).toBe(60_000);
    expect(giftCardAmountFor(200_000, 100_000)).toBe(100_000);
    expect(giftCardAmountFor(100_000, 100_000)).toBe(100_000);
    expect(giftCardAmountFor(0, 100_000)).toBe(0);
  });
});

describe("canViewGiftCard", () => {
  it("shows a card to the user who bought it and to the browser it was bought in", () => {
    expect(canViewGiftCard(card(), { userId: 3, giftCardIds: [] })).toBe(true);
    expect(canViewGiftCard(card({ buyerUserId: null }), { userId: null, giftCardIds: [7] })).toBe(
      true,
    );
    expect(canViewGiftCard(card(), { userId: 4, giftCardIds: [8] })).toBe(false);
    expect(canViewGiftCard(card({ buyerUserId: null }), { userId: null, giftCardIds: [] })).toBe(
      false,
    );
  });
});

describe("toGiftCardView", () => {
  it("shows the code once the card is paid", () => {
    expect(toGiftCardView(card(), NOW)).toMatchObject({
      code: "ABCDEFGHJKMNPQRS",
      status: "active",
    });
    expect(toGiftCardView(card({ status: "pending", expiresAt: null }), NOW).code).toBeNull();
  });

  it("reads an active card past its date as expired", () => {
    expect(toGiftCardView(card(), new Date("2027-11-05T10:00:00Z")).status).toBe("expired");
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("createGiftCard", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_gift_cards_service_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  it("creates a pending card and drops a recipient who is the buyer", async () => {
    const { createGiftCard, getGiftCardView } = await import("./gift-cards");
    const viewer = { userId: null, giftCardIds: [] as number[] };
    const id = await createGiftCard(
      {
        amount: 2000,
        email: "me@example.com",
        recipientEmail: "ME@example.com",
        userId: null,
        locale: "en",
      },
      { db: testDb.db },
    );
    expect(await getGiftCardView(id, viewer, testDb.db)).toBeUndefined();
    expect(await getGiftCardView(id, { ...viewer, giftCardIds: [id] }, testDb.db)).toMatchObject({
      status: "pending",
      initialAmount: "2000.00",
      balance: "2000.00",
      code: null,
      recipientEmail: null,
    });
  });

  it("tries another code when one is taken", async () => {
    const { createGiftCard } = await import("./gift-cards");
    const { findGiftCard } = await import("../db/queries/gift-cards");
    const codes = ["TAKEN00000000000", "TAKEN00000000000", "FRESH00000000000"];
    const generateCode = () => codes.shift() ?? "";
    const input = {
      amount: 500,
      email: "a@example.com",
      recipientEmail: "b@example.com",
      userId: null,
      locale: "uk",
    } as const;
    await createGiftCard(input, { db: testDb.db, generateCode });
    const id = await createGiftCard(input, { db: testDb.db, generateCode });
    expect(await findGiftCard(testDb.db, id)).toMatchObject({
      code: "FRESH00000000000",
      recipientEmail: "b@example.com",
    });
  });
});
