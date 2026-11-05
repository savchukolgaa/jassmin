import type Mail from "nodemailer/lib/mailer";
import type { Translator } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n/locales";
import { pathFor } from "~/lib/paths";
import type { Db } from "../db";
import { composeEmail } from "../email/layout";
import type { Env } from "../env";
import type { MailSender } from "../mail";
import { stripLineBreaks } from "../mail";

// The password reset and email verification emails (#135), in the shared layout (#134) and the
// request's language, from `CONTACT_FROM`, each with its one-time link as a button. Sent directly
// and best effort, like the email-changed notice: the user can always ask for another link. The
// app's mailer (`getMailer`) never sends to a suppressed address.

export type AuthEmailEnv = Pick<Env, "CONTACT_FROM" | "CONTACT_INBOX" | "PUBLIC_SITE_URL">;

/** What the reset and verification services need, injectable for tests. */
export interface AuthEmailDeps {
  db: Db;
  /** `null` when `SMTP_URL` is not configured: nothing is sent. */
  mailer: MailSender | null;
  env: AuthEmailEnv;
  now: () => Date;
}

export interface AuthEmail {
  to: string;
  fullName: string;
  /** The absolute one-time link. */
  link: string;
}

/** The absolute URL of a reset or verification page for `token`, in `locale`. */
export function authLink(
  siteUrl: string,
  locale: Locale,
  page: "resetPassword" | "verifyEmail",
  token: string,
): string {
  return `${siteUrl}${pathFor(locale, page, { token })}`;
}

function buildEmail(
  kind: "reset" | "verify",
  email: AuthEmail,
  translator: Translator,
  env: AuthEmailEnv,
): Mail.Options {
  const { t } = translator;
  return composeEmail({
    from: env.CONTACT_FROM,
    to: email.to,
    replyTo: env.CONTACT_INBOX,
    subject: t(`auth.${kind}.mail.subject`),
    preheader: t(`auth.${kind}.mail.validity`),
    blocks: [
      {
        type: "paragraph",
        text: t(`auth.${kind}.mail.greeting`, { name: stripLineBreaks(email.fullName) }),
      },
      { type: "paragraph", text: t(`auth.${kind}.mail.body`) },
      { type: "button", label: t(`auth.${kind}.mail.button`), url: email.link },
      { type: "paragraph", text: t(`auth.${kind}.mail.validity`) },
      { type: "paragraph", text: t(`auth.${kind}.mail.notYou`) },
      { type: "signature", text: t(`auth.${kind}.mail.signature`) },
    ],
    translator,
    footer: { inbox: env.CONTACT_INBOX, siteUrl: env.PUBLIC_SITE_URL },
  });
}

/** The email with a link to set a new password. */
export function buildPasswordResetEmail(
  email: AuthEmail,
  translator: Translator,
  env: AuthEmailEnv,
): Mail.Options {
  return buildEmail("reset", email, translator, env);
}

/** The email with a link to confirm the address. */
export function buildVerificationEmail(
  email: AuthEmail,
  translator: Translator,
  env: AuthEmailEnv,
): Mail.Options {
  return buildEmail("verify", email, translator, env);
}
