import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getEnv } from "./env";

// Outgoing email over SMTP (`SMTP_URL`). Locally that's smtp4dev, which catches every message
// and shows it in its web UI, so nothing leaves the machine.

const TIMEOUT_MS = 10_000;

/** The part of a nodemailer transport the mail services use, so tests can pass a fake. */
export interface MailSender {
  sendMail(options: Mail.Options): Promise<unknown>;
}

/** User input for a header (a name or subject): line breaks become spaces, so no header injection. */
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** SMTP options for an `smtp://` or `smtps://` URL (`smtps` = implicit TLS, default port 465). */
export function smtpOptionsFromUrl(smtpUrl: string): SMTPTransport.Options {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  const user = decodeURIComponent(url.username);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 25,
    secure,
    auth: user ? { user, pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  };
}

let transport: Transporter | null | undefined;

/** The shared SMTP transport, or `null` when `SMTP_URL` is not configured. */
export function getMailTransport(): Transporter | null {
  if (transport === undefined) {
    const { SMTP_URL } = getEnv();
    transport = SMTP_URL ? nodemailer.createTransport(smtpOptionsFromUrl(SMTP_URL)) : null;
  }
  return transport;
}
