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

describe("password reset email", () => {
  const email = {
    to: "olena@example.com",
    fullName: "Olena\r\nBcc: evil@example.com",
    link: `${SITE}/novyi-parol/abc`,
  };

  it("sends the link in Ukrainian, without header injection", async () => {
    const { buildPasswordResetEmail } = await import("./auth-emails");

    const mail = buildPasswordResetEmail(email, createTranslator("uk"), env);

    expect(mail).toMatchObject({
      from: env.CONTACT_FROM,
      to: "olena@example.com",
      replyTo: env.CONTACT_INBOX,
      subject: "Відновлення пароля — Jassmin",
    });
    expect(mail.text).toContain("Вітаємо, Olena Bcc: evil@example.com!");
    expect(mail.text).toContain(`\n${SITE}/novyi-parol/abc\n`);
    expect(mail.text).toContain("1 годину");
  });

  it("is written in English for the English site", async () => {
    const { authLink, buildPasswordResetEmail } = await import("./auth-emails");

    const link = authLink(SITE, "en", "resetPassword", "abc");
    expect(link).toBe(`${SITE}/en/reset-password/abc`);
    const mail = buildPasswordResetEmail({ ...email, link }, createTranslator("en"), env);
    expect(mail.subject).toBe("Reset your password — Jassmin");
    expect(mail.text).toContain("1 hour");
  });
});

// Integration tests: run only when a database is configured, on their own throwaway database.
describe.skipIf(!hasDatabase)("password reset service", () => {
  let testDb: TestDatabase;
  const start = new Date("2026-11-05T12:00:00Z");

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_password_reset_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  let counter = 0;
  async function createUser() {
    const { registerUser } = await import("./auth");
    counter += 1;
    const email = `reset${counter}@example.com`;
    const result = await registerUser(testDb.db, {
      fullName: "Olena Petrenko",
      email,
      password: "old password",
    });
    if (!result.ok) throw new Error("registration failed");
    return { id: result.userId, email };
  }

  /** Asks for a reset and returns the token from the emailed link. */
  async function requestToken(email: string, now = start, locale: "uk" | "en" = "uk") {
    const { requestPasswordReset } = await import("./password-reset");
    const sendMail = vi.fn<(options: Mail.Options) => Promise<unknown>>().mockResolvedValue({});
    await requestPasswordReset(
      { email, locale, siteUrl: SITE },
      { db: testDb.db, mailer: { sendMail }, env, now: () => now },
    );
    const text = String(sendMail.mock.calls[0]?.[0].text ?? "");
    const match = text.match(/\/(?:novyi-parol|en\/reset-password)\/([A-Za-z0-9_-]{43})/);
    return { sendMail, token: match?.[1] };
  }

  it("emails a link whose token is stored only as its hash", async () => {
    const { authTokens } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const { hashAuthToken } = await import("../auth-tokens");
    const user = await createUser();

    const { sendMail, token } = await requestToken(user.email);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
    if (!token) throw new Error("no token in the email");
    const rows = await testDb.db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "password_reset",
      tokenHash: hashAuthToken(token),
      expiresAt: new Date("2026-11-05T13:00:00Z"),
      usedAt: null,
    });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("sends nothing for an unknown email and never rejects", async () => {
    const { requestPasswordReset } = await import("./password-reset");
    const { sendMail } = await requestToken("nobody@example.com");
    expect(sendMail).not.toHaveBeenCalled();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await createUser();
    const failing = { sendMail: vi.fn().mockRejectedValue(new Error("SMTP down")) };
    await expect(
      requestPasswordReset(
        { email: user.email, locale: "uk", siteUrl: SITE },
        { db: testDb.db, mailer: failing, env, now: () => start },
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("links to the English page for the English site", async () => {
    const user = await createUser();
    const { sendMail, token } = await requestToken(user.email, start, "en");
    expect(token).toBeDefined();
    expect(sendMail.mock.calls[0]?.[0].subject).toBe("Reset your password — Jassmin");
  });

  it("sets the password once, records the change and confirms the email", async () => {
    const { inspectResetToken, resetPassword } = await import("./password-reset");
    const { verifyLogin } = await import("./auth");
    const { findSessionUser } = await import("../db/queries/users");
    const user = await createUser();
    const { token } = await requestToken(user.email);
    if (!token) throw new Error("no token");
    const deps = { db: testDb.db, now: () => new Date("2026-11-05T12:30:00Z") };

    expect(await inspectResetToken(token, deps)).toEqual({ ok: true, userId: user.id });
    const result = await resetPassword({ token, password: "new password" }, deps);
    expect(result).toEqual({
      ok: true,
      userId: user.id,
      email: user.email,
      changedAt: new Date("2026-11-05T12:30:00Z"),
    });

    expect(await verifyLogin(testDb.db, user.email, "new password")).toMatchObject({ ok: true });
    expect(await verifyLogin(testDb.db, user.email, "old password")).toEqual({ ok: false });
    expect(await findSessionUser(testDb.db, user.id)).toMatchObject({
      emailVerified: true,
      passwordChangedAt: new Date("2026-11-05T12:30:00Z"),
    });

    // The link works only once.
    expect(await inspectResetToken(token, deps)).toEqual({ ok: false, error: "used" });
    expect(await resetPassword({ token, password: "another one" }, deps)).toEqual({
      ok: false,
      error: "used",
    });
  });

  it("refuses a link after an hour, and unknown links", async () => {
    const { resetPassword } = await import("./password-reset");
    const user = await createUser();
    const { token } = await requestToken(user.email);
    if (!token) throw new Error("no token");

    const late = { db: testDb.db, now: () => new Date("2026-11-05T13:00:00Z") };
    expect(await resetPassword({ token, password: "new password" }, late)).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await resetPassword({ token: "x".repeat(43), password: "new password" }, late)).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("invalidates the user's other reset links", async () => {
    const { inspectResetToken, resetPassword } = await import("./password-reset");
    const user = await createUser();
    const first = await requestToken(user.email);
    const second = await requestToken(user.email);
    if (!first.token || !second.token) throw new Error("no token");
    const deps = { db: testDb.db, now: () => new Date("2026-11-05T12:10:00Z") };

    expect(
      await resetPassword({ token: second.token, password: "new password" }, deps),
    ).toMatchObject({ ok: true });
    expect(await inspectResetToken(first.token, deps)).toEqual({ ok: false, error: "used" });
  });
});
