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
const changedAt = new Date("2026-10-25T10:00:00Z");
const notice = {
  to: "old@example.com",
  newEmail: "new@example.com",
  fullName: "Olena\r\nBcc: evil@example.com",
  changedAt,
};

describe("email-changed notice", () => {
  it("goes to the old address and names the new one, in Ukrainian", async () => {
    const { buildEmailChangedNotice } = await import("./profile");

    const mail = buildEmailChangedNotice(notice, createTranslator("uk"), env);

    expect(mail).toMatchObject({
      from: env.CONTACT_FROM,
      to: "old@example.com",
      replyTo: env.CONTACT_INBOX,
      subject: "Email вашого облікового запису змінено — Jassmin",
    });
    expect(mail.text).toContain("Вітаємо, Olena Bcc: evil@example.com!");
    expect(mail.text).toContain("new@example.com");
    expect(mail.text).toContain(createTranslator("uk").formatDate(changedAt.toISOString()));
    expect(mail.text).toContain("hello@jassmin.ua");
  });

  it("uses the shared HTML layout with the same words as the text part (#134)", async () => {
    const { buildEmailChangedNotice } = await import("./profile");
    const { htmlSection, htmlWords, words } = await import("../email/test-helpers");

    for (const locale of ["uk", "en"] as const) {
      const mail = buildEmailChangedNotice(notice, createTranslator(locale), env);
      const html = String(mail.html);
      const [body] = String(mail.text).split("\n\n-- \n");
      expect(html).toContain(`<html lang="${locale}">`);
      expect(htmlWords(htmlSection(html, "content"))).toEqual(words(body ?? ""));
      expect(mail.messageId).toMatch(/@jassmin\.ua>$/);
    }
  });

  it("is written in English for the English site", async () => {
    const { buildEmailChangedNotice } = await import("./profile");

    const mail = buildEmailChangedNotice(notice, createTranslator("en"), env);

    expect(mail.subject).toBe("Your account email was changed — Jassmin");
    expect(mail.text).toContain("changed to new@example.com");
  });

  it("sends through the mailer, skips without one and never rejects", async () => {
    const { notifyEmailChanged } = await import("./profile");
    const input = { to: "old@example.com", newEmail: "new@example.com", fullName: "Olena" };
    const sendMail = vi.fn().mockResolvedValue({});

    await notifyEmailChanged(
      { ...input, locale: "en" },
      { mailer: { sendMail }, env, now: () => changedAt },
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "old@example.com", from: env.CONTACT_FROM }),
    );

    await expect(
      notifyEmailChanged({ ...input, locale: "uk" }, { mailer: null, env, now: () => changedAt }),
    ).resolves.toBeUndefined();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { sendMail: vi.fn().mockRejectedValue(new Error("SMTP down")) };
    await expect(
      notifyEmailChanged(
        { ...input, locale: "uk" },
        { mailer: failing, env, now: () => changedAt },
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

// Integration tests: run only when a database is configured, on their own throwaway database.
describe.skipIf(!hasDatabase)("profile service", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_profile_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  let counter = 0;
  async function createUser(password = "correct horse") {
    const { registerUser } = await import("./auth");
    counter += 1;
    const email = `profile${counter}@example.com`;
    const result = await registerUser(testDb.db, {
      fullName: "Olena Petrenko",
      email,
      password,
      phone: "+380 67 123 45 67",
    });
    if (!result.ok) throw new Error("registration failed");
    return { id: result.userId, email };
  }

  async function readHash(id: number) {
    const { findUserCredentialsById } = await import("../db/queries/users");
    return (await findUserCredentialsById(testDb.db, id))?.passwordHash;
  }

  it("loads the profile without the password hash", async () => {
    const { getProfile } = await import("./profile");
    const { id, email } = await createUser();

    const profile = await getProfile(id, testDb.db);

    expect(profile).toEqual({
      fullName: "Olena Petrenko",
      email,
      phone: "+380 67 123 45 67",
      createdAt: expect.any(Date),
    });
    expect(JSON.stringify(profile)).not.toContain("argon2");
  });

  it("updates the contact details the checkout prefill reads, and clears the phone", async () => {
    const { updateContact } = await import("./profile");
    const { getCheckoutPrefill } = await import("./orders");
    const { id, email } = await createUser();

    await updateContact(id, { fullName: "Olena Koval", phone: "+380 50 000 00 00" }, testDb.db);
    expect(await getCheckoutPrefill(id, testDb.db)).toEqual({
      fullName: "Olena Koval",
      email,
      phone: "+380 50 000 00 00",
    });

    await updateContact(id, { fullName: "Olena Koval" }, testDb.db);
    expect((await getCheckoutPrefill(id, testDb.db))?.phone).toBeNull();
  });

  it("changes the email only with the current password", async () => {
    const { changeEmail, getProfile } = await import("./profile");
    const { id, email } = await createUser();

    expect(await changeEmail(id, "wrong password", "new1@example.com", testDb.db)).toEqual({
      ok: false,
      error: "wrong-password",
    });
    expect((await getProfile(id, testDb.db)).email).toBe(email);

    expect(await changeEmail(id, "correct horse", "new1@example.com", testDb.db)).toEqual({
      ok: true,
      previousEmail: email,
    });
    expect((await getProfile(id, testDb.db)).email).toBe("new1@example.com");
  });

  it("reports a taken email and an unchanged one", async () => {
    const { changeEmail } = await import("./profile");
    const other = await createUser();
    const { id, email } = await createUser();

    expect(await changeEmail(id, "correct horse", other.email, testDb.db)).toEqual({
      ok: false,
      error: "email-taken",
    });
    expect(await changeEmail(id, "correct horse", email, testDb.db)).toEqual({
      ok: true,
      previousEmail: null,
    });
  });

  it("stores a new password only as an argon2id hash", async () => {
    const { changePassword } = await import("./profile");
    const { verifyLogin } = await import("./auth");
    const { id, email } = await createUser();
    const before = await readHash(id);

    expect(await changePassword(id, "wrong password", "brand new secret", testDb.db)).toEqual({
      ok: false,
      error: "wrong-password",
    });
    expect(await readHash(id)).toBe(before);

    expect(await changePassword(id, "correct horse", "brand new secret", testDb.db)).toEqual({
      ok: true,
    });
    const hash = await readHash(id);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("brand new secret");
    expect((await verifyLogin(testDb.db, email, "brand new secret")).ok).toBe(true);
    expect((await verifyLogin(testDb.db, email, "correct horse")).ok).toBe(false);
  });
});
