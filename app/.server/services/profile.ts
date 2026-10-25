import type Mail from "nodemailer/lib/mailer";
import type { AccountProfile } from "~/lib/account";
import { createTranslator, type Locale, type Translator } from "~/lib/i18n";
import { type Db, db } from "../db";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import {
  findUserCredentialsById,
  findUserProfile,
  updateUserContact,
  updateUserEmail,
  updateUserPasswordHash,
} from "../db/queries/users";
import { type Env, getEnv } from "../env";
import { getMailTransport, type MailSender, stripLineBreaks } from "../mail";
import { hashPassword, verifyPassword } from "../password";

// The account profile page (#54): contact details, email and password. Email and password changes
// need the current password; the route rate-limits wrong ones (`profilePasswordLimiter`).

/** The profile of a logged-in user. Throws when the user is gone (`requireUser` ran just before). */
export async function getProfile(userId: number, database: Db = db): Promise<AccountProfile> {
  const profile = await findUserProfile(database, userId);
  if (!profile) {
    throw new Error(`User ${userId} not found`);
  }
  return profile;
}

/** Sets the name and phone. An `undefined` phone clears it. */
export async function updateContact(
  userId: number,
  contact: { fullName: string; phone?: string },
  database: Db = db,
): Promise<void> {
  await updateUserContact(database, userId, {
    fullName: contact.fullName,
    phone: contact.phone ?? null,
  });
}

async function isCurrentPassword(database: Db, userId: number, password: string): Promise<boolean> {
  const credentials = await findUserCredentialsById(database, userId);
  return credentials !== undefined && (await verifyPassword(credentials.passwordHash, password));
}

export type ChangeEmailResult =
  /** `previousEmail` is `null` when the email was already this one, so nothing changed. */
  | { ok: true; previousEmail: string | null }
  | { ok: false; error: "wrong-password" | "email-taken" };

/** Changes the email to an (already normalised) new one, after checking the current password. */
export async function changeEmail(
  userId: number,
  currentPassword: string,
  newEmail: string,
  database: Db = db,
): Promise<ChangeEmailResult> {
  if (!(await isCurrentPassword(database, userId, currentPassword))) {
    return { ok: false, error: "wrong-password" };
  }

  const profile = await getProfile(userId, database);
  if (profile.email === newEmail) {
    return { ok: true, previousEmail: null };
  }

  try {
    await updateUserEmail(database, userId, newEmail);
  } catch (error: unknown) {
    // The unique index decides, so two users can't race to the same address.
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return { ok: false, error: "email-taken" };
    }
    throw error;
  }
  return { ok: true, previousEmail: profile.email };
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: "wrong-password" };

/** Stores the argon2id hash of a new password, after checking the current one. */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  database: Db = db,
): Promise<ChangePasswordResult> {
  if (!(await isCurrentPassword(database, userId, currentPassword))) {
    return { ok: false, error: "wrong-password" };
  }
  await updateUserPasswordHash(database, userId, await hashPassword(newPassword));
  return { ok: true };
}

export interface EmailChangedNotice {
  /** The previous address: the person who owns it learns about the change. */
  to: string;
  newEmail: string;
  fullName: string;
  changedAt: Date;
}

export type EmailChangedEnv = Pick<Env, "CONTACT_FROM" | "CONTACT_INBOX">;

/** The plain-text notice sent to the old address after an email change. */
export function buildEmailChangedNotice(
  notice: EmailChangedNotice,
  translator: Translator,
  env: EmailChangedEnv,
): Mail.Options {
  const { t, formatDate } = translator;
  return {
    from: env.CONTACT_FROM,
    to: notice.to,
    replyTo: env.CONTACT_INBOX,
    subject: t("account.profile.emailChangedMail.subject"),
    text: [
      t("account.profile.emailChangedMail.greeting", { name: stripLineBreaks(notice.fullName) }),
      "",
      t("account.profile.emailChangedMail.body", {
        date: formatDate(notice.changedAt.toISOString()),
        newEmail: notice.newEmail,
      }),
      "",
      t("account.profile.emailChangedMail.notYou", { email: env.CONTACT_INBOX }),
      "",
      t("account.profile.emailChangedMail.signature"),
    ].join("\n"),
  };
}

export interface EmailChangedDeps {
  /** `null` when `SMTP_URL` is not configured: nothing is sent. */
  mailer: MailSender | null;
  env: EmailChangedEnv;
  now: () => Date;
}

function defaultEmailChangedDeps(): EmailChangedDeps {
  return { mailer: getMailTransport(), env: getEnv(), now: () => new Date() };
}

/**
 * Tells the old address that the account's email changed. Best effort: it never rejects, and a
 * notice that can't be sent is only logged (there's no outbox or retry, unlike order emails).
 */
export async function notifyEmailChanged(
  notice: Omit<EmailChangedNotice, "changedAt"> & { locale: Locale },
  deps?: EmailChangedDeps,
): Promise<void> {
  try {
    const { mailer, env, now } = deps ?? defaultEmailChangedDeps();
    if (!mailer) return;
    const { locale, ...rest } = notice;
    await mailer.sendMail(
      buildEmailChangedNotice({ ...rest, changedAt: now() }, createTranslator(locale), env),
    );
  } catch (error: unknown) {
    console.error("Sending the email-changed notice failed", error);
  }
}
