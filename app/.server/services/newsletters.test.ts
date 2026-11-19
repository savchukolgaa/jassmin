import type Mail from "nodemailer/lib/mailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsletterContent } from "~/lib/newsletter";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import type { MailSender } from "../mail";
import type { NewsletterEnv } from "./newsletters";

const env: NewsletterEnv = {
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin <no-reply@jassmin.ua>",
  ORDER_FROM: undefined,
  PUBLIC_SITE_URL: "https://jassmin.ua",
  EMAIL_UNSUBSCRIBE_SECRET: "n".repeat(32),
  NEWSLETTER_DAILY_LIMIT: 200,
};

const content: NewsletterContent = {
  slug: "autumn-news",
  uk: {
    subject: "Осінні новинки",
    preheader: "Нові аромати",
    body: "Привіт! [Каталог](/catalog/women)",
  },
  en: { subject: "Autumn arrivals", preheader: null, body: "Hello! [Catalog](/en/catalog/women)" },
  productPublicIds: [],
};

const DAY = 24 * 60 * 60 * 1000;

function fakeMailer(fail?: (message: Mail.Options) => Error | undefined) {
  const sent: Mail.Options[] = [];
  const mailer: MailSender & { sent: Mail.Options[] } = {
    sent,
    sendMail: vi.fn(async (message: Mail.Options) => {
      const error = fail?.(message);
      if (error) throw error;
      sent.push(message);
      return {};
    }),
  };
  return mailer;
}

describe("sending without configuration", () => {
  it("refuses a send and a test, and sends no deliveries, without SMTP, the site or the secret", async () => {
    const { deliverNewsletters, sendNewsletter, sendNewsletterTest } = await import(
      "./newsletters"
    );
    const db = {} as Parameters<typeof sendNewsletter>[2]["db"];
    expect(await sendNewsletter("doc", content, { db, mailer: null, env })).toEqual({
      ok: false,
      error: "mail-not-configured",
      missing: ["SMTP_URL"],
    });
    const bare = { ...env, PUBLIC_SITE_URL: undefined, EMAIL_UNSUBSCRIBE_SECRET: undefined };
    const mailer = fakeMailer();
    expect(await sendNewsletter("doc", content, { db, mailer, env: bare })).toEqual({
      ok: false,
      error: "mail-not-configured",
      missing: ["PUBLIC_SITE_URL", "EMAIL_UNSUBSCRIBE_SECRET"],
    });
    expect(
      await sendNewsletterTest(content, { email: "a@b.c", name: "A" }, { db, mailer, env: bare }),
    ).toEqual({ ok: false, error: "mail-not-configured", missing: ["PUBLIC_SITE_URL"] });
    expect((await deliverNewsletters({ db, mailer: null, env })).notConfigured).toEqual([
      "SMTP_URL",
    ]);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("newsletters", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    testDb = await createTestDatabase("jassmin_newsletter_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sql } = await import("drizzle-orm");
    await testDb.db.execute(sql`delete from newsletter_deliveries`);
    await testDb.db.execute(sql`delete from newsletters`);
    await testDb.db.execute(sql`delete from cms_outbox`);
    await testDb.db.execute(sql`delete from email_suppressions`);
    await testDb.db.execute(sql`delete from users`);
  });

  interface UserOptions {
    optIn?: boolean;
    verified?: boolean;
    locale?: "uk" | "en" | null;
  }

  async function addUser(
    email: string,
    { optIn = true, verified = true, locale = null }: UserOptions = {},
  ) {
    const { users } = await import("../db/schema");
    const [user] = await testDb.db
      .insert(users)
      .values({
        fullName: email.split("@")[0] ?? "x",
        email,
        passwordHash: "x",
        marketingOptIn: optIn,
        emailVerifiedAt: verified ? new Date() : null,
        locale,
      })
      .returning();
    if (!user) throw new Error("no user");
    return user.id;
  }

  async function deliveries() {
    const { asc } = await import("drizzle-orm");
    const { newsletterDeliveries } = await import("../db/schema");
    return testDb.db
      .select({
        userId: newsletterDeliveries.userId,
        locale: newsletterDeliveries.locale,
        status: newsletterDeliveries.status,
        error: newsletterDeliveries.error,
      })
      .from(newsletterDeliveries)
      .orderBy(asc(newsletterDeliveries.userId));
  }

  async function send(
    documentId = "doc-1",
    at = new Date(),
    body: NewsletterContent = content,
    mailer: MailSender = fakeMailer(),
  ) {
    const { sendNewsletter } = await import("./newsletters");
    return sendNewsletter(documentId, body, { db: testDb.db, mailer, env, now: () => at });
  }

  it("queues every opted-in, verified, not suppressed customer once, in their language", async () => {
    const { emailSuppressions } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    const uk = await addUser("uk@example.com", { locale: "uk" });
    const none = await addUser("none@example.com");
    const en = await addUser("en@example.com", { locale: "en" });
    await addUser("out@example.com", { optIn: false });
    await addUser("unverified@example.com", { verified: false });
    await addUser("Bounced@Example.com");
    await testDb.db
      .insert(emailSuppressions)
      .values({ address: "bounced@example.com", reason: "hard_bounce" });

    const result = await send();

    expect(result).toMatchObject({
      ok: true,
      state: { status: "sending", counts: { queued: 3, sent: 0, failed: 0, skipped: 0 } },
    });
    expect(await deliveries()).toEqual([
      { userId: uk, locale: "uk", status: "queued", error: null },
      { userId: none, locale: "uk", status: "queued", error: null },
      { userId: en, locale: "en", status: "queued", error: null },
    ]);
    // Strapi gets the counts through the outbox.
    const outbox = await testDb.db.execute(sql`select entity from cms_outbox`);
    expect(outbox.rows).toEqual([{ entity: "newsletter" }]);
  });

  it("sends English customers the Ukrainian version when there is no English one", async () => {
    await addUser("en@example.com", { locale: "en" });
    expect(await send("doc-uk", new Date(), { ...content, en: null })).toMatchObject({ ok: true });
    expect((await deliveries()).map((d) => d.locale)).toEqual(["uk"]);
  });

  it("refuses a second send of the same newsletter and a send within 7 days", async () => {
    const { sql } = await import("drizzle-orm");
    await addUser("a@example.com");
    const start = new Date("2026-11-02T10:00:00Z");
    const winter = { ...content, slug: "winter-news" };
    expect(await send("doc-1", start)).toMatchObject({ ok: true });

    // Still sending: nothing else goes out, not even after a week.
    expect(await send("doc-1", start)).toEqual({ ok: false, error: "already-sent" });
    expect(await send("doc-2", new Date(start.getTime() + 8 * DAY), winter)).toEqual({
      ok: false,
      error: "another-sending",
    });

    await testDb.db.execute(sql`update newsletters set status = 'sent'`);
    expect(await send("doc-1", new Date(start.getTime() + 8 * DAY))).toEqual({
      ok: false,
      error: "already-sent",
    });
    expect(await send("doc-2", new Date(start.getTime() + 6 * DAY), winter)).toEqual({
      ok: false,
      error: "too-soon",
      nextAllowedAt: "2026-11-09T10:00:00.000Z",
    });
    const week = new Date(start.getTime() + 7 * DAY);
    // Each newsletter is its own campaign.
    expect(await send("doc-2", week)).toEqual({
      ok: false,
      error: "newsletter-slug-taken",
      slug: "autumn-news",
    });
    expect(await send("doc-2", week, winter)).toMatchObject({
      ok: true,
    });
  });

  it("refuses a newsletter nobody would get and stores nothing", async () => {
    const { sql } = await import("drizzle-orm");
    await addUser("out@example.com", { optIn: false });
    expect(await send()).toEqual({ ok: false, error: "no-recipients" });
    const rows = await testDb.db.execute(sql`select 1 from newsletters`);
    expect(rows.rows).toEqual([]);
  });

  it("stores one newsletter when two sends race", async () => {
    const { sql } = await import("drizzle-orm");
    await addUser("a@example.com");
    const results = await Promise.all([send("doc-1"), send("doc-2"), send("doc-1")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rows = await testDb.db.execute(sql`select 1 from newsletters`);
    expect(rows.rows).toHaveLength(1);
  });

  it("sends within the daily limit and continues the next day", async () => {
    const { sql } = await import("drizzle-orm");
    const { deliverNewsletters } = await import("./newsletters");
    for (const name of ["a", "b", "c", "d", "e"]) await addUser(`${name}@example.com`);
    await send();
    const mailer = fakeMailer();
    const limited = { db: testDb.db, mailer, env: { ...env, NEWSLETTER_DAILY_LIMIT: 3 } };

    const first = await deliverNewsletters(limited);
    expect(first).toMatchObject({ sent: 3, limitReached: true, finished: [] });
    expect(mailer.sent).toHaveLength(3);

    expect(await deliverNewsletters(limited)).toMatchObject({ sent: 0, limitReached: true });
    expect(mailer.sent).toHaveLength(3);

    // A day later the window has room again.
    await testDb.db.execute(
      sql`update newsletter_deliveries set sent_at = sent_at - interval '25 hours' where sent_at is not null`,
    );
    const next = await deliverNewsletters(limited);
    expect(next).toMatchObject({ sent: 2, limitReached: false });
    expect(next.finished).toHaveLength(1);
    expect(new Set(mailer.sent.map((m) => JSON.stringify(m.to))).size).toBe(5);
    const [newsletter] = (
      await testDb.db.execute(sql`select status, completed_at from newsletters`)
    ).rows;
    expect(newsletter).toMatchObject({ status: "sent" });
    expect(newsletter?.completed_at).not.toBeNull();
  });

  it("adds the one-click unsubscribe headers, the tag and the UTM links", async () => {
    const { deliverNewsletters } = await import("./newsletters");
    const { verifyUnsubscribeToken } = await import("../unsubscribe-token");
    const userId = await addUser("en@example.com", { locale: "en" });
    await send();
    const mailer = fakeMailer();
    await deliverNewsletters({ db: testDb.db, mailer, env });

    const [message] = mailer.sent;
    const headers = message?.headers as Record<string, string>;
    const url = headers["List-Unsubscribe"]?.slice(1, -1) ?? "";
    expect(url).toMatch(/^https:\/\/jassmin\.ua\/en\/unsubscribe\//);
    expect(
      verifyUnsubscribeToken(url.split("/").at(-1) ?? "", env.EMAIL_UNSUBSCRIBE_SECRET ?? ""),
    ).toBe(userId);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["X-Mailin-custom"]).toMatch(/^newsletter:\d+$/);
    expect(message?.subject).toBe("Autumn arrivals");
    expect(String(message?.text)).toContain(
      "https://jassmin.ua/en/catalog/women?utm_source=newsletter&utm_medium=email&utm_campaign=autumn-news",
    );
    expect(String(message?.text)).toContain(url);
  });

  it("skips customers who unsubscribed, lost verification or bounced after queuing", async () => {
    const { sql } = await import("drizzle-orm");
    const { deliverNewsletters } = await import("./newsletters");
    const { emailSuppressions } = await import("../db/schema");
    const out = await addUser("out@example.com");
    const unverified = await addUser("unverified@example.com");
    const bounced = await addUser("bounced@example.com");
    const stays = await addUser("stays@example.com");
    await send();
    await testDb.db.execute(sql`update users set marketing_opt_in = false where id = ${out}`);
    await testDb.db.execute(
      sql`update users set email_verified_at = null where id = ${unverified}`,
    );
    await testDb.db
      .insert(emailSuppressions)
      .values({ address: "bounced@example.com", reason: "complaint" });

    const mailer = fakeMailer();
    const report = await deliverNewsletters({ db: testDb.db, mailer, env });

    expect(report).toMatchObject({ sent: 1, skipped: 3 });
    expect(mailer.sent.map((m) => m.to)).toEqual([{ name: "stays", address: "stays@example.com" }]);
    expect(await deliveries()).toEqual([
      { userId: out, locale: "uk", status: "skipped", error: "unsubscribed" },
      { userId: unverified, locale: "uk", status: "skipped", error: "email not verified" },
      { userId: bounced, locale: "uk", status: "skipped", error: "suppressed" },
      { userId: stays, locale: "uk", status: "sent", error: null },
    ]);
  });

  it("retries a failed send and gives up after the last attempt", async () => {
    const { sql } = await import("drizzle-orm");
    const { deliverNewsletters } = await import("./newsletters");
    await addUser("a@example.com");
    await send();
    const mailer = fakeMailer(() => new Error("SMTP timeout"));
    const deps = { db: testDb.db, mailer, env };

    expect(await deliverNewsletters(deps)).toMatchObject({ retrying: 1, failed: 0 });
    expect((await deliveries())[0]).toMatchObject({ status: "queued", error: "SMTP timeout" });
    // Not due again until the retry time.
    expect(await deliverNewsletters(deps)).toMatchObject({ retrying: 0, failed: 0 });

    const due = sql`update newsletter_deliveries set next_attempt_at = now()`;
    await testDb.db.execute(due);
    expect(await deliverNewsletters(deps)).toMatchObject({ retrying: 1 });
    await testDb.db.execute(due);
    const last = await deliverNewsletters(deps);
    expect(last).toMatchObject({ retrying: 0, failed: 1 });
    expect(last.finished).toHaveLength(1);
    expect((await deliveries())[0]).toMatchObject({ status: "failed" });
  });

  it("never sends a delivery twice when two runs overlap", async () => {
    const { deliverNewsletters } = await import("./newsletters");
    for (let i = 0; i < 12; i += 1) await addUser(`u${i}@example.com`);
    await send();
    const mailer = fakeMailer();
    const deps = { db: testDb.db, mailer, env };
    await Promise.all([
      deliverNewsletters(deps),
      deliverNewsletters(deps),
      deliverNewsletters(deps),
    ]);
    expect(mailer.sent).toHaveLength(12);
    expect(new Set(mailer.sent.map((m) => JSON.stringify(m.to))).size).toBe(12);
  });

  it("shows the featured products still on sale, in staff's order, with today's price", async () => {
    const { sql } = await import("drizzle-orm");
    const { loadNewsletterProducts } = await import("./newsletters");
    const rows = await testDb.db.execute<{ public_id: string }>(
      sql`select public_id from products where active order by id limit 2`,
    );
    const [first, second] = rows.rows.map((row) => row.public_id);
    if (!first || !second) throw new Error("no products");
    const unknown = "01900000-0000-7000-8000-000000000000";

    const products = await loadNewsletterProducts(testDb.db, [second, unknown, first]);
    expect(products.map((p) => p.publicId)).toEqual([second, first]);
    expect(products[0]?.minPrice).toMatch(/^\d+\.\d{2}$/);

    await testDb.db.execute(sql`update products set active = false where public_id = ${second}`);
    expect(
      (await loadNewsletterProducts(testDb.db, [second, first])).map((p) => p.publicId),
    ).toEqual([first]);
    await testDb.db.execute(sql`update products set active = true where public_id = ${second}`);
  });

  it("sends a test only to the staff member, once per language, and stores nothing", async () => {
    const { sql } = await import("drizzle-orm");
    const { sendNewsletterTest } = await import("./newsletters");
    await addUser("customer@example.com");
    const mailer = fakeMailer();
    const deps = { db: testDb.db, mailer, env };

    expect(
      await sendNewsletterTest(content, { email: "staff@jassmin.ua", name: "Olha" }, deps),
    ).toEqual({ ok: true, sent: 2 });
    expect(mailer.sent.map((m) => [m.to, m.subject])).toEqual([
      [{ name: "Olha", address: "staff@jassmin.ua" }, "[Тест] Осінні новинки"],
      [{ name: "Olha", address: "staff@jassmin.ua" }, "[Test] Autumn arrivals"],
    ]);
    // No shop account with that address: no unsubscribe link.
    expect(mailer.sent[0]?.headers).toBeUndefined();
    const rows = await testDb.db.execute(sql`select 1 from newsletters`);
    expect(rows.rows).toEqual([]);

    // With an account, the link is that user's.
    await addUser("staff@jassmin.ua");
    const again = fakeMailer();
    await sendNewsletterTest(
      { ...content, en: null },
      { email: "Staff@Jassmin.ua", name: "O" },
      {
        ...deps,
        mailer: again,
      },
    );
    expect(again.sent).toHaveLength(1);
    const headers = again.sent[0]?.headers as Record<string, string> | undefined;
    expect(headers?.["List-Unsubscribe"]).toBeDefined();

    const { SuppressedRecipientError } = await import("../mail");
    const suppressed = fakeMailer(() => new SuppressedRecipientError(["hard_bounce"]));
    expect(
      await sendNewsletterTest(
        content,
        { email: "staff@jassmin.ua", name: "O" },
        { ...deps, mailer: suppressed },
      ),
    ).toEqual({ ok: false, error: "test-suppressed" });
    const broken = fakeMailer(() => new Error("down"));
    expect(
      await sendNewsletterTest(
        content,
        { email: "staff@jassmin.ua", name: "O" },
        { ...deps, mailer: broken },
      ),
    ).toEqual({ ok: false, error: "mail-failed" });
  });
});
