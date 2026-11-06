import { EMAIL_VERIFICATION_TTL_HOURS } from "~/lib/auth";
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
import { findUserRecipientById, markEmailVerified } from "../db/queries/users";
import { getEnv } from "../env";
import { type AuthEmailDeps, authLink, buildVerificationEmail } from "./auth-emails";
import { getMailer } from "./mailer";

// Email verification (#135): a link, valid for a week, that confirms the address. It's soft:
// unverified users can log in and order; the account page offers to resend the link.

function defaultDeps(): AuthEmailDeps {
  return { db, mailer: getMailer(), env: getEnv(), now: () => new Date() };
}

/**
 * Emails a verification link to the user's current address, unless it's already confirmed. Best
 * effort: never rejects, and failures are only logged.
 */
export async function sendVerificationEmail(
  request: { userId: number; locale: Locale; siteUrl: string },
  deps?: AuthEmailDeps,
): Promise<void> {
  try {
    const { db: database, mailer, env, now } = deps ?? defaultDeps();
    const user = await findUserRecipientById(database, request.userId);
    if (!user || user.emailVerified) return;
    if (!mailer) {
      console.warn("SMTP_URL is not set: the verification email was not sent");
      return;
    }

    const { token, hash } = generateAuthToken();
    const expiresAt = new Date(now().getTime() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);
    await insertAuthToken(database, {
      userId: user.id,
      purpose: "email_verification",
      hash,
      expiresAt,
    });
    await mailer.sendMail(
      buildVerificationEmail(
        {
          to: user.email,
          fullName: user.fullName,
          link: authLink(request.siteUrl, request.locale, "verifyEmail", token),
        },
        createTranslator(request.locale),
        env,
      ),
    );
  } catch (error: unknown) {
    console.error("Sending the verification email failed", error);
  }
}

/** Whether the link's token can still confirm the email, without using it up. */
export async function inspectVerificationToken(
  token: string,
  deps?: Pick<AuthEmailDeps, "db" | "now">,
): Promise<AuthTokenCheck> {
  const { db: database, now } = deps ?? defaultDeps();
  return inspectAuthToken(database, "email_verification", hashAuthToken(token), now());
}

/**
 * Confirms the email with a verification link, in one transaction: uses the token up, sets
 * `users.email_verified_at` and invalidates the user's other verification links.
 */
export async function verifyEmail(
  token: string,
  deps?: Pick<AuthEmailDeps, "db" | "now">,
): Promise<AuthTokenCheck> {
  const { db: database, now } = deps ?? defaultDeps();
  const at = now();
  return database.transaction(async (tx) => {
    const check = await consumeAuthToken(tx, "email_verification", hashAuthToken(token), at);
    if (!check.ok) return check;
    await markEmailVerified(tx, check.userId, at);
    await invalidateUserTokens(tx, check.userId, "email_verification", at);
    return check;
  });
}
