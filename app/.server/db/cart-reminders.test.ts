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
};

describe("sendCartRemindersJob without configuration", () => {
  it("queues nothing without SMTP, the site URL or the unsubscribe secret", async () => {
    const { sendCartRemindersJob } = await import("./cart-reminders");
    const db = {} as Parameters<typeof sendCartRemindersJob>[0];
    const sendMail = vi.fn();

    expect(await sendCartRemindersJob(db, null, env)).toEqual({
      queued: [],
      report: null,
      message: "No cart reminders queued: SMTP_URL not set (see docs/email.md).",
    });
    const bare = { ...env, PUBLIC_SITE_URL: undefined, EMAIL_UNSUBSCRIBE_SECRET: undefined };
    expect((await sendCartRemindersJob(db, { sendMail }, bare)).message).toBe(
      "No cart reminders queued: PUBLIC_SITE_URL, EMAIL_UNSUBSCRIBE_SECRET not set (see docs/email.md).",
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("sendCartRemindersJob", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./test-utils");
    const { migrateLatest } = await import("./migrator");
    const { seedProducts } = await import("./seed");
    testDb = await createTestDatabase("jassmin_cart_reminder_job_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("sends one reminder for an eligible cart, and none on the next run", async () => {
    const { sql } = await import("drizzle-orm");
    const { cartItems, carts, productVariants, users } = await import("./schema");
    const { findCartReminderEmail } = await import("./queries/cart-reminders");
    const { sendCartRemindersJob } = await import("./cart-reminders");
    const { db } = testDb;

    const [user] = await db
      .insert(users)
      .values({
        fullName: "Olena",
        email: "olena-job@example.com",
        passwordHash: "x",
        marketingOptIn: true,
        locale: "en",
      })
      .returning();
    const [variant] = await db.select().from(productVariants).limit(1);
    if (!user || !variant) throw new Error("no fixtures");
    await db.execute(sql`update product_variants set stock_quantity = 5 where id = ${variant.id}`);
    const [cart] = await db
      .insert(carts)
      .values({ userId: user.id, status: "abandoned" })
      .returning();
    const cartId = cart?.id ?? 0;
    await db
      .insert(cartItems)
      .values({ cartId, productId: variant.productId, variantId: variant.id, quantity: 2 });
    await db.execute(sql`update carts set updated_at = now() - interval '26 hours',
      abandoned_at = now() - interval '2 hours' where id = ${cartId}`);

    const sendMail = vi.fn(async (_message: Mail.Options) => ({}));
    const first = await sendCartRemindersJob(db, { sendMail }, env);

    expect(first.queued).toEqual([cartId]);
    expect(first.report).toEqual({ sent: 1, retrying: 0, gaveUp: 0, skipped: false });
    expect(first.message).toBe(
      "Queued 1 cart reminder. Order emails: 1 sent, 0 to retry, 0 given up.",
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toEqual({ name: "Olena", address: "olena-job@example.com" });
    expect(String(message?.text)).toContain("https://jassmin.ua/en/cart?restore=1");
    expect(await findCartReminderEmail(db, cartId)).toMatchObject({ status: "sent", locale: "en" });

    const second = await sendCartRemindersJob(db, { sendMail }, env);
    expect(second.queued).toEqual([]);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
