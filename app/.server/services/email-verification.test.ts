import type Mail from "nodemailer/lib/mailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/lib/i18n";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || "postgres://u:p@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

const env = {
  CONTACT_FROM: "Jassmin <no-reply@jassmin.ua>",
  CONTACT_INBOX: "hello@jassmin.ua",
};
const SITE = "https://jassmin.ua";

describe("verification email", () => {
  it("sends the link in Ukrainian and in English", async () => {
    const { authLink, buildVerificationEmail } = await import("./auth-emails");
    const email = { to: "olena@example.com", fullName: "Olena", link: "" };

    const uk = buildVerificationEmail(
      { ...email, link: authLink(SITE, "uk", "verifyEmail", "abc") },
      createTranslator("uk"),
      env,
    );
    expect(uk.subject).toBe("Підтвердіть email — Jassmin");
    expect(uk.text).toContain(`\n${SITE}/pidtverdzhennia/abc\n`);
    expect(uk.text).toContain("7 днів");

    const en = buildVerificationEmail(
      { ...email, link: authLink(SITE, "en", "verifyEmail", "abc") },
      createTranslator("en"),
      env,
    );
    expect(en.subject).toBe("Confirm your email — Jassmin");
    expect(en.text).toContain(`\n${SITE}/en/verify-email/abc\n`);
  });
});

// Integration tests: run only when a database is configured, on their own throwaway database.
describe.skipIf(!hasDatabase)("email verification service", () => {
  let testDb: TestDatabase;
  const start = new Date("2026-11-05T12:00:00Z");

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_email_verification_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  let counter = 0;
  async function createUser() {
    const { registerUser } = await import("./auth");
    counter += 1;
    const email = `verify${counter}@example.com`;
    const result = await registerUser(testDb.db, {
      fullName: "Olena",
      email,
      password: "password",
    });
    if (!result.ok) throw new Error("registration failed");
    return { id: result.userId, email };
  }

  async function sendToken(userId: number, now = start) {
    const { sendVerificationEmail } = await import("./email-verification");
    const sendMail = vi.fn<(options: Mail.Options) => Promise<unknown>>().mockResolvedValue({});
    await sendVerificationEmail(
      { userId, locale: "uk", siteUrl: SITE },
      { db: testDb.db, mailer: { sendMail }, env, now: () => now },
    );
    const text = String(sendMail.mock.calls[0]?.[0].text ?? "");
    return { sendMail, token: text.match(/\/pidtverdzhennia\/([A-Za-z0-9_-]{43})/)?.[1] };
  }

  it("confirms the email once and sets email_verified_at", async () => {
    const { inspectVerificationToken, verifyEmail } = await import("./email-verification");
    const { findUserById } = await import("../db/queries/users");
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const user = await createUser();
    const { sendMail, token } = await sendToken(user.id);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
    if (!token) throw new Error("no token");
    const at = new Date("2026-11-06T09:00:00Z");
    const deps = { db: testDb.db, now: () => at };

    expect(await inspectVerificationToken(token, deps)).toEqual({ ok: true, userId: user.id });
    expect(await verifyEmail(token, deps)).toEqual({ ok: true, userId: user.id });
    const [row] = await testDb.db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.emailVerifiedAt).toEqual(at);
    expect((await findUserById(testDb.db, user.id))?.emailVerified).toBe(true);

    expect(await verifyEmail(token, deps)).toEqual({ ok: false, error: "used" });
  });

  it("refuses a link after 7 days", async () => {
    const { verifyEmail } = await import("./email-verification");
    const user = await createUser();
    const { token } = await sendToken(user.id);
    if (!token) throw new Error("no token");

    const late = { db: testDb.db, now: () => new Date("2026-11-12T12:00:00Z") };
    expect(await verifyEmail(token, late)).toEqual({ ok: false, error: "expired" });
  });

  it("sends nothing once the email is confirmed, or for an unknown user", async () => {
    const { verifyEmail } = await import("./email-verification");
    const user = await createUser();
    const first = await sendToken(user.id);
    // A resent link: the first one still works until one of them is used.
    const second = await sendToken(user.id);
    if (!first.token || !second.token) throw new Error("no token");
    const deps = { db: testDb.db, now: () => start };
    expect(await verifyEmail(first.token, deps)).toMatchObject({ ok: true });
    expect(await verifyEmail(second.token, deps)).toEqual({ ok: false, error: "used" });

    expect((await sendToken(user.id)).sendMail).not.toHaveBeenCalled();
    expect((await sendToken(999_999)).sendMail).not.toHaveBeenCalled();
  });

  it("marks a changed email unverified (#135)", async () => {
    const { verifyEmail } = await import("./email-verification");
    const { findUserById, updateUserEmail } = await import("../db/queries/users");
    const user = await createUser();
    const { token } = await sendToken(user.id);
    if (!token) throw new Error("no token");
    await verifyEmail(token, { db: testDb.db, now: () => start });

    await updateUserEmail(testDb.db, user.id, `changed-${user.email}`);
    expect((await findUserById(testDb.db, user.id))?.emailVerified).toBe(false);
  });
});
