import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "../test-utils";
import {
  generateTesterFollowupCode,
  TESTER_FOLLOWUP_CODE_LENGTH,
  TESTER_FOLLOWUP_CODE_PREFIX,
} from "./tester-followups";

const DAYS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("generateTesterFollowupCode", () => {
  it("is the prefix and eight base-32 symbols, valid as a promo code", () => {
    const code = generateTesterFollowupCode();
    expect(code).toMatch(new RegExp(`^${TESTER_FOLLOWUP_CODE_PREFIX}[0-9A-Z]{8}$`));
    expect(code).toHaveLength(TESTER_FOLLOWUP_CODE_PREFIX.length + TESTER_FOLLOWUP_CODE_LENGTH);
    expect(generateTesterFollowupCode(() => 0)).toBe("TRY-00000000");
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("tester follow-up queries", () => {
  let testDb: TestDatabase;
  let counter = 0;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_tester_followups_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await testDb.db.execute(
      sql`truncate order_emails, order_items, orders, cart_items, carts, newsletter_deliveries,
          newsletters, email_suppressions, users, product_variants, products restart identity
          cascade`,
    );
    await testDb.db.execute(sql`delete from discounts where slug like 'tester-followup-%'`);
  });

  async function exec<T extends Record<string, unknown>>(
    query: ReturnType<typeof import("drizzle-orm").sql>,
  ) {
    return (await testDb.db.execute<T>(query)).rows;
  }

  /** A single perfume with a tester and full sizes, all in stock unless `soldOut`. */
  async function perfume(
    title: string,
    { soldOut = false, packSize = 1 }: { soldOut?: boolean; packSize?: number } = {},
  ) {
    const { sql } = await import("drizzle-orm");
    const [product] = await exec<{ id: number; public_id: string }>(sql`
      insert into products (title, brand, gender, price, volume_ml, pack_size, slug)
      values (${title}, 'Brand', 'women', '1000.00', 50, ${packSize}, ${title.toLowerCase()})
      returning id, public_id`);
    if (!product) throw new Error("no product");
    const stock = soldOut ? 0 : 5;
    await exec(sql`
      insert into product_variants (product_id, volume_ml, price, stock_quantity, track_stock)
      values (${product.id}, 10, '200.00', 5, true),
             (${product.id}, 30, '900.00', ${stock}, true),
             (${product.id}, 50, '1300.00', ${stock}, true),
             (${product.id}, 100, '2100.00', ${stock}, true)`);
    return { id: product.id, publicId: product.public_id };
  }

  async function user({
    optIn = true,
    verified = true,
    locale = null,
  }: {
    optIn?: boolean;
    verified?: boolean;
    locale?: "uk" | "en" | null;
  } = {}) {
    const { sql } = await import("drizzle-orm");
    counter += 1;
    const [row] = await exec<{ id: number; email: string }>(sql`
      insert into users (full_name, email, password_hash, marketing_opt_in, email_verified_at,
        locale)
      values ('Olena', ${`Tester${counter}@Example.com`}, 'x', ${optIn},
        ${verified ? sql`now()` : sql`null`}, ${locale})
      returning id, email`);
    if (!row) throw new Error("no user");
    return row;
  }

  /**
   * An order of `userId` with a line of `volumeMl` for each product, placed `createdDaysAgo` days
   * ago and in `status` with the given lifecycle dates (days ago).
   */
  async function order(
    userId: number | null,
    lines: { productId: number; volumeMl?: number }[],
    {
      status = "completed",
      createdDaysAgo = 20,
      completedDaysAgo = (DAYS + 1) as number | null,
      arrivedDaysAgo = null as number | null,
      shippedDaysAgo = (DAYS + 3) as number | null,
      returned = false,
    } = {},
  ) {
    const { sql } = await import("drizzle-orm");
    const ago = (days: number | null) =>
      days === null ? sql`null` : sql`now() - make_interval(days => ${days})`;
    const [row] = await exec<{ id: number }>(sql`
      insert into orders (user_id, guest_full_name, guest_email, guest_phone, shipping_address,
        payment_method, subtotal, total_amount, status, created_at, completed_at, arrived_at,
        shipped_at, returned_at)
      values (${userId}, 'Olena', 'buyer@example.com', '+380501234567', 'Kyiv', 'cod', '600.00',
        '600.00', ${status}, ${ago(createdDaysAgo)}, ${ago(completedDaysAgo)},
        ${ago(arrivedDaysAgo)}, ${ago(shippedDaysAgo)}, ${returned ? sql`now()` : sql`null`})
      returning id`);
    if (!row) throw new Error("no order");
    for (const line of lines) {
      const volume = line.volumeMl ?? 10;
      await exec(sql`
        insert into order_items (order_id, product_id, variant_id, volume_ml, quantity,
          price_at_purchase)
        select ${row.id}, ${line.productId}, v.id, ${volume}, 1, v.price
        from product_variants v where v.product_id = ${line.productId} and v.volume_ml = ${volume}`);
    }
    return row.id;
  }

  async function candidates() {
    const { findTesterFollowupCandidates } = await import("./tester-followups");
    return findTesterFollowupCandidates(testDb.db, { days: DAYS });
  }

  async function candidateOrders() {
    return (await candidates()).map((c) => c.orderId);
  }

  async function queue(options: { generateCode?: () => string } = {}) {
    const { queueTesterFollowups } = await import("./tester-followups");
    return queueTesterFollowups(testDb.db, { days: DAYS, percent: 10, ...options });
  }

  it("finds a delivered tester order of an opted-in, verified customer", async () => {
    const a = await perfume("Amber");
    const b = await perfume("Bloom");
    const customer = await user({ locale: "en" });
    const orderId = await order(customer.id, [{ productId: a.id }, { productId: b.id }]);

    expect(await candidates()).toEqual([
      {
        orderId,
        userId: customer.id,
        locale: "en",
        productPublicIds: [a.publicId, b.publicId].sort(),
      },
    ]);
  });

  it("writes Ukrainian when the customer has no language", async () => {
    const a = await perfume("Amber");
    const customer = await user();
    await order(customer.id, [{ productId: a.id }]);
    expect((await candidates())[0]?.locale).toBe("uk");
  });

  it("skips guests, customers without consent or a verified address, and suppressed ones", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    await order(null, [{ productId: a.id }]);
    await order((await user({ optIn: false })).id, [{ productId: a.id }]);
    await order((await user({ verified: false })).id, [{ productId: a.id }]);
    const suppressed = await user();
    await order(suppressed.id, [{ productId: a.id }]);
    await exec(sql`
      insert into email_suppressions (address, reason)
      values (${suppressed.email.toLowerCase()}, 'hard_bounce')`);

    expect(await candidates()).toEqual([]);
  });

  it("only takes shipped or completed orders that didn't come back", async () => {
    const a = await perfume("Amber");
    for (const status of ["pending", "paid", "cancelled", "returned", "unclaimed"] as const) {
      await order((await user()).id, [{ productId: a.id }], { status });
    }
    await order((await user()).id, [{ productId: a.id }], { status: "completed", returned: true });
    expect(await candidates()).toEqual([]);
  });

  it("waits TESTER_FOLLOWUP_DAYS after delivery, and gives up after the window", async () => {
    const a = await perfume("Amber");
    await order((await user()).id, [{ productId: a.id }], { completedDaysAgo: DAYS - 1 });
    await order((await user()).id, [{ productId: a.id }], { completedDaysAgo: DAYS + 15 });
    const due = await order((await user()).id, [{ productId: a.id }], {
      completedDaysAgo: DAYS + 13,
    });
    expect(await candidateOrders()).toEqual([due]);
  });

  it("dates delivery by pickup, then arrival, then shipping plus three days", async () => {
    const a = await perfume("Amber");
    // Arrived long enough ago, not picked up yet: due.
    const arrived = await order((await user()).id, [{ productId: a.id }], {
      status: "shipped",
      completedDaysAgo: null,
      arrivedDaysAgo: DAYS,
    });
    // Shipped DAYS + 3 days ago, no other date: delivered DAYS ago, due.
    const shipped = await order((await user()).id, [{ productId: a.id }], {
      status: "shipped",
      completedDaysAgo: null,
      shippedDaysAgo: DAYS + 3,
    });
    // Shipped DAYS + 2 days ago: delivered DAYS − 1 days ago, not due yet.
    await order((await user()).id, [{ productId: a.id }], {
      status: "shipped",
      completedDaysAgo: null,
      shippedDaysAgo: DAYS + 2,
    });
    // Arrived long ago but picked up recently: the pickup counts.
    await order((await user()).id, [{ productId: a.id }], {
      completedDaysAgo: 2,
      arrivedDaysAgo: DAYS + 5,
    });
    expect(await candidateOrders()).toEqual([arrived, shipped]);
  });

  it("needs a single-perfume 10 ml line", async () => {
    const a = await perfume("Amber");
    const set = await perfume("Trio set", { packSize: 3 });
    await order((await user()).id, [{ productId: a.id, volumeMl: 50 }]);
    await order((await user()).id, [{ productId: set.id }]);
    expect(await candidates()).toEqual([]);
  });

  it("skips customers who bought a full bottle of a tried perfume since", async () => {
    const a = await perfume("Amber");
    const b = await perfume("Bloom");
    const c = await perfume("Cedar");
    const bought = await user();
    await order(bought.id, [{ productId: a.id }, { productId: b.id }]);
    await order(bought.id, [{ productId: b.id, volumeMl: 50 }], {
      status: "pending",
      createdDaysAgo: 3,
    });
    // A cancelled bottle order, or a bottle of another perfume, doesn't count.
    const other = await user();
    const otherOrder = await order(other.id, [{ productId: a.id }]);
    await order(other.id, [{ productId: a.id, volumeMl: 30 }], {
      status: "cancelled",
      createdDaysAgo: 3,
    });
    await order(other.id, [{ productId: c.id, volumeMl: 100 }], {
      status: "pending",
      createdDaysAgo: 3,
    });
    expect(await candidateOrders()).toEqual([otherOrder]);
  });

  it("leaves out sold-out and archived perfumes, and skips the order when none remain", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    const soldOut = await perfume("Bloom", { soldOut: true });
    const archived = await perfume("Cedar");
    await exec(sql`update products set active = false where id = ${archived.id}`);
    const kept = await order((await user()).id, [
      { productId: a.id },
      { productId: soldOut.id },
      { productId: archived.id },
    ]);
    await order((await user()).id, [{ productId: soldOut.id }, { productId: archived.id }]);

    expect(await candidates()).toMatchObject([{ orderId: kept, productPublicIds: [a.publicId] }]);
  });

  it("counts an untracked full size as in stock", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber", { soldOut: true });
    await exec(sql`update product_variants set track_stock = false where volume_ml = 50`);
    await order((await user()).id, [{ productId: a.id }]);
    expect(await candidates()).toHaveLength(1);
  });

  it("takes one order per customer, the latest delivered", async () => {
    const a = await perfume("Amber");
    const customer = await user();
    await order(customer.id, [{ productId: a.id }], { completedDaysAgo: DAYS + 5 });
    const latest = await order(customer.id, [{ productId: a.id }], { completedDaysAgo: DAYS + 1 });
    expect(await candidateOrders()).toEqual([latest]);
  });

  it("spaces follow-ups 30 days apart per customer", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    const customer = await user();
    const earlier = await order(customer.id, [{ productId: a.id }], { createdDaysAgo: 60 });
    const due = await order(customer.id, [{ productId: a.id }]);
    await exec(sql`
      insert into order_emails (order_id, type, locale, created_at)
      values (${earlier}, 'tester_followup', 'uk', now() - interval '29 days')`);
    expect(await candidates()).toEqual([]);

    await exec(sql`update order_emails set created_at = now() - interval '31 days'`);
    expect(await candidateOrders()).toEqual([due]);
  });

  it("waits 7 days after a cart reminder", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    const customer = await user();
    const due = await order(customer.id, [{ productId: a.id }]);
    await exec(sql`
      insert into carts (user_id, status, reminder_sent_at)
      values (${customer.id}, 'abandoned', now() - interval '6 days')`);
    expect(await candidates()).toEqual([]);

    await exec(sql`update carts set reminder_sent_at = now() - interval '8 days'`);
    expect(await candidateOrders()).toEqual([due]);
  });

  it("waits 7 days after a newsletter, and while one is still queued", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    const customer = await user();
    const due = await order(customer.id, [{ productId: a.id }]);
    const [newsletter] = await exec<{ id: number }>(sql`
      insert into newsletters (strapi_document_id, slug, subject_uk, body_uk)
      values ('doc1', 'spring', 'Весна', 'Текст') returning id`);
    await exec(sql`
      insert into newsletter_deliveries (newsletter_id, user_id, locale, status)
      values (${newsletter?.id}, ${customer.id}, 'uk', 'queued')`);
    expect(await candidates()).toEqual([]);

    await exec(sql`
      update newsletter_deliveries set status = 'sent', sent_at = now() - interval '6 days'`);
    expect(await candidates()).toEqual([]);

    await exec(sql`update newsletter_deliveries set sent_at = now() - interval '8 days'`);
    expect(await candidateOrders()).toEqual([due]);
  });

  it("queues one email and a scoped, single-use, 30-day code per order", async () => {
    const { findTesterFollowupEmail, findTesterFollowup } = await import("./tester-followups");
    const { findDiscountBySlug } = await import("./discounts");
    const a = await perfume("Amber");
    const b = await perfume("Bloom", { soldOut: true });
    const customer = await user({ locale: "en" });
    const orderId = await order(customer.id, [{ productId: a.id }, { productId: b.id }]);

    const before = Date.now();
    expect(await queue()).toEqual([orderId]);
    expect(await queue()).toEqual([]);

    expect(await findTesterFollowupEmail(testDb.db, orderId)).toMatchObject({
      locale: "en",
      status: "pending",
    });
    const discount = await findDiscountBySlug(testDb.db, `tester-followup-${orderId}`);
    expect(discount).toMatchObject({
      kind: "percent",
      value: "10.00",
      scopeProductPublicIds: [a.publicId],
      scopeVolumesMl: [30, 50, 100],
      scopePackSize: 1,
      maxRedemptions: 1,
      redemptionCount: 0,
      active: true,
    });
    expect(discount?.code).toMatch(/^TRY-[0-9A-Z]{8}$/);
    const validMs = (discount?.endsAt?.getTime() ?? 0) - (discount?.startsAt?.getTime() ?? 0);
    expect(validMs).toBe(30 * DAY_MS);
    expect(discount?.startsAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);

    expect(await findTesterFollowup(testDb.db, orderId)).toMatchObject({
      orderId,
      userId: customer.id,
      email: customer.email,
      marketingOptIn: true,
      emailVerified: true,
      orderStatus: "completed",
      returned: false,
      boughtBottleSince: false,
      discount: { code: discount?.code, percent: "10.00", active: true, usedUp: false },
      products: [
        {
          publicId: a.publicId,
          slug: "amber",
          title: "Amber",
          brand: "Brand",
          imageUrl: null,
          fromPrice: "900.00",
        },
      ],
    });
  });

  it("tries another code when one is taken", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    await exec(sql`
      insert into discounts (slug, code, kind, value) values ('taken', 'TRY-AAAAAAAA', 'percent', 5)`);
    const orderId = await order((await user()).id, [{ productId: a.id }]);
    const codes = ["TRY-AAAAAAAA", "TRY-BBBBBBBB"];
    expect(await queue({ generateCode: () => codes.shift() ?? "TRY-CCCCCCCC" })).toEqual([orderId]);
    const [row] = await exec<{ code: string }>(
      sql`select code from discounts where slug = ${`tester-followup-${orderId}`}`,
    );
    expect(row?.code).toBe("TRY-BBBBBBBB");
    await exec(sql`delete from discounts where slug = 'taken'`);
  });

  it("queues once when two runs race", async () => {
    const { sql } = await import("drizzle-orm");
    const a = await perfume("Amber");
    const orderId = await order((await user()).id, [{ productId: a.id }]);
    const results = await Promise.all([queue(), queue()]);
    expect(results.flat()).toEqual([orderId]);
    const [count] = await exec<{ n: number }>(
      sql`select count(*)::int as n from discounts where slug like 'tester-followup-%'`,
    );
    expect(count?.n).toBe(1);
  });

  it("reads what changed since queuing when the email is sent", async () => {
    const { sql } = await import("drizzle-orm");
    const { findTesterFollowup } = await import("./tester-followups");
    const a = await perfume("Amber");
    const b = await perfume("Bloom");
    const customer = await user();
    const orderId = await order(customer.id, [{ productId: a.id }, { productId: b.id }]);
    await queue();

    await exec(sql`update product_variants set stock_quantity = 0
      where product_id = ${a.id} and volume_ml > 10`);
    await exec(sql`update users set marketing_opt_in = false where id = ${customer.id}`);
    await order(customer.id, [{ productId: b.id, volumeMl: 30 }], {
      status: "pending",
      createdDaysAgo: 1,
    });
    await exec(sql`update discounts set redemption_count = 1
      where slug = ${`tester-followup-${orderId}`}`);

    expect(await findTesterFollowup(testDb.db, orderId)).toMatchObject({
      marketingOptIn: false,
      boughtBottleSince: true,
      discount: { usedUp: true },
      products: [{ publicId: b.publicId }],
    });
  });

  it("finds no follow-up for a guest order or an unknown one", async () => {
    const { findTesterFollowup } = await import("./tester-followups");
    const a = await perfume("Amber");
    const guestOrder = await order(null, [{ productId: a.id }]);
    expect(await findTesterFollowup(testDb.db, guestOrder)).toBeUndefined();
    expect(await findTesterFollowup(testDb.db, 999_999)).toBeUndefined();
  });
});
