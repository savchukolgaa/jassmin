import type Mail from "nodemailer/lib/mailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailEnv } from "../env";
import { hasDatabase, type TestDatabase } from "./test-utils";

const env: MailEnv = {
  NODE_ENV: "test",
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin <no-reply@jassmin.ua>",
  PUBLIC_SITE_URL: "https://jassmin.ua",
  EMAIL_UNSUBSCRIBE_SECRET: "j".repeat(32),
  NEWSLETTER_DAILY_LIMIT: 200,
  TESTER_FOLLOWUP_DAYS: 12,
  TESTER_FOLLOWUP_PERCENT: 15,
};

describe("sendTesterFollowupsJob without configuration", () => {
  it("queues nothing without SMTP, the site URL or the unsubscribe secret", async () => {
    const { sendTesterFollowupsJob } = await import("./tester-followups");
    const db = {} as Parameters<typeof sendTesterFollowupsJob>[0];
    const sendMail = vi.fn();

    expect(await sendTesterFollowupsJob(db, null, env)).toEqual({
      queued: [],
      report: null,
      message: "No tester follow-ups queued: SMTP_URL not set (see docs/email.md).",
    });
    const bare = { ...env, PUBLIC_SITE_URL: undefined, EMAIL_UNSUBSCRIBE_SECRET: undefined };
    expect((await sendTesterFollowupsJob(db, { sendMail }, bare)).message).toBe(
      "No tester follow-ups queued: PUBLIC_SITE_URL, EMAIL_UNSUBSCRIBE_SECRET not set (see docs/email.md).",
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("sendTesterFollowupsJob", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    testDb = await createTestDatabase("jassmin_tester_followup_job_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("sends one follow-up with the code for a delivered tester order, and none on the next run", async () => {
    const { sql } = await import("drizzle-orm");
    const { findTesterFollowupEmail } = await import("./queries/tester-followups");
    const { findDiscountBySlug } = await import("./queries/discounts");
    const { sendTesterFollowupsJob } = await import("./tester-followups");
    const { db } = testDb;

    const products = await db.execute<{ id: number }>(sql`
      insert into products (title, brand, gender, price, volume_ml, slug)
      values ('Amber', 'Brand', 'women', '1000.00', 50, 'amber') returning id`);
    const productId = products.rows[0]?.id;
    await db.execute(sql`
      insert into product_variants (product_id, volume_ml, price, stock_quantity, track_stock)
      values (${productId}, 10, '200.00', 5, true), (${productId}, 50, '1300.00', 5, true)`);
    const users = await db.execute<{ id: number }>(sql`
      insert into users (full_name, email, password_hash, marketing_opt_in, email_verified_at,
        locale)
      values ('Olena', 'olena-job@example.com', 'x', true, now(), 'en') returning id`);
    const orders = await db.execute<{ id: number }>(sql`
      insert into orders (user_id, guest_full_name, guest_email, guest_phone, shipping_address,
        payment_method, subtotal, total_amount, status, created_at, shipped_at, completed_at)
      values (${users.rows[0]?.id}, 'Olena', 'olena-job@example.com', '+380501234567', 'Kyiv',
        'cod', '200.00', '200.00', 'completed', now() - interval '20 days',
        now() - interval '16 days', now() - interval '13 days')
      returning id`);
    const orderId = orders.rows[0]?.id ?? 0;
    await db.execute(sql`
      insert into order_items (order_id, product_id, variant_id, volume_ml, quantity,
        price_at_purchase)
      select ${orderId}, ${productId}, v.id, 10, 1, v.price
      from product_variants v where v.product_id = ${productId} and v.volume_ml = 10`);

    const sendMail = vi.fn(async (_message: Mail.Options) => ({}));
    const first = await sendTesterFollowupsJob(db, { sendMail }, env);

    expect(first.queued).toEqual([orderId]);
    expect(first.report).toEqual({ sent: 1, retrying: 0, gaveUp: 0, skipped: false });
    expect(first.message).toBe(
      "Queued 1 tester follow-up. Order emails: 1 sent, 0 to retry, 0 given up.",
    );
    const discount = await findDiscountBySlug(db, `tester-followup-${orderId}`);
    expect(discount?.value).toBe("15.00");
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toEqual({ name: "Olena", address: "olena-job@example.com" });
    expect(message?.subject).toBe("Which one did you like? — Jassmin");
    expect(String(message?.text)).toContain(
      `https://jassmin.ua/en/perfumes/amber?code=${discount?.code}&utm_source=email`,
    );
    expect(String(message?.text)).toContain("15% off a full bottle");
    expect(await findTesterFollowupEmail(db, orderId)).toMatchObject({
      status: "sent",
      locale: "en",
    });

    const second = await sendTesterFollowupsJob(db, { sendMail }, env);
    expect(second.queued).toEqual([]);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
