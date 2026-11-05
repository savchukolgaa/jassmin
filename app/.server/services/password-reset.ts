import { PASSWORD_RESET_TTL_MINUTES } from "~/lib/auth";
import { createTranslator } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n/locales";
import { generateAuthToken, hashAuthToken } from "../auth-tokens";
import { db } from "../db";
import {
  type AuthTokenCheck,
  consumeAuthToken,
  insertAuthToken,
  inspectAuthToken,
  invalidateUserTokens,
} from "../db/queries/auth-tokens";
import { findUserRecipientByEmail, setPasswordChanged } from "../db/queries/users";
import { getEnv } from "../env";
import { getMailTransport } from "../mail";
import { hashPassword } from "../password";
import { type AuthEmailDeps, authLink, buildPasswordResetEmail } from "./auth-emails";

// "Forgot password" (#135): a one-time link, valid for an hour, to set a new password. Setting it
// logs out every other session (`users.password_changed_at`).

function defaultDeps(): AuthEmailDeps {
  return { db, mailer: getMailTransport(), env: getEnv(), now: () => new Date() };
}

/**
 * Emails a reset link when an account has this (already normalised) email, and does nothing
 * otherwise. The route answers before calling it finishes, so the response is the same whether
 * the account exists or not. Never rejects: failures are only logged.
 */
export async function requestPasswordReset(
  request: { email: string; locale: Locale; siteUrl: string },
  deps?: AuthEmailDeps,
): Promise<void> {
  try {
    const { db: database, mailer, env, now } = deps ?? defaultDeps();
    const user = await findUserRecipientByEmail(database, request.email);
    if (!user) return;
    if (!mailer) {
      console.warn("SMTP_URL is not set: the password reset email was not sent");
      return;
    }

    const { token, hash } = generateAuthToken();
    const expiresAt = new Date(now().getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
    await insertAuthToken(database, {
      userId: user.id,
      purpose: "password_reset",
      hash,
      expiresAt,
    });
    await mailer.sendMail(
      buildPasswordResetEmail(
        {
          to: user.email,
          fullName: user.fullName,
          link: authLink(request.siteUrl, request.locale, "resetPassword", token),
        },
        createTranslator(request.locale),
        env,
      ),
    );
  } catch (error: unknown) {
    console.error("Sending the password reset email failed", error);
  }
}

/** Whether the link's token can still set a password, without using it up. */
export async function inspectResetToken(
  token: string,
  deps?: Pick<AuthEmailDeps, "db" | "now">,
): Promise<AuthTokenCheck> {
  const { db: database, now } = deps ?? defaultDeps();
  return inspectAuthToken(database, "password_reset", hashAuthToken(token), now());
}

export type ResetPasswordResult =
  | {
      ok: true;
      userId: number;
      email: string;
      /** Stored as `password_changed_at`: the new session's `authenticatedAt`. */
      changedAt: Date;
    }
  | Extract<AuthTokenCheck, { ok: false }>;

/**
 * Sets a new password with a reset link, in one transaction: uses the token up, stores the hash
 * and the change time (which revokes the user's other sessions), confirms the email and
 * invalidates the user's other reset links.
 */
export async function resetPassword(
  input: { token: string; password: string },
  deps?: Pick<AuthEmailDeps, "db" | "now">,
): Promise<ResetPasswordResult> {
  const { db: database, now } = deps ?? defaultDeps();
  // Hashed before the transaction, so the token's row isn't locked during argon2.
  const passwordHash = await hashPassword(input.password);
  const changedAt = now();
  return database.transaction(async (tx) => {
    const check = await consumeAuthToken(
      tx,
      "password_reset",
      hashAuthToken(input.token),
      changedAt,
    );
    if (!check.ok) return check;

    const user = await setPasswordChanged(tx, check.userId, {
      passwordHash,
      changedAt,
      verifyEmail: true,
    });
    if (!user) throw new Error(`User ${check.userId} not found`);
    await invalidateUserTokens(tx, check.userId, "password_reset", changedAt);
    return { ok: true, userId: check.userId, email: user.email, changedAt };
  });
}
