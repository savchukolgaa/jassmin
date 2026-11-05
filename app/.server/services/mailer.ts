// The web app's mailer (#134): the shared SMTP transport, but never to a suppressed address.
// `pnpm db:send-order-emails` wraps its own transport the same way, with its own pool.
import { getMailTransport, type MailSender, withSuppressions } from "../mail";

/** The app's mailer, or `null` when `SMTP_URL` is not configured. */
export function getMailer(): MailSender | null {
  const transport = getMailTransport();
  if (!transport) return null;
  return withSuppressions(transport, async (addresses) => {
    // Imported here, so services that only send email don't open the app pool on import.
    const [{ db }, { findEmailSuppressions }] = await Promise.all([
      import("../db"),
      import("../db/queries/email-suppressions"),
    ]);
    return findEmailSuppressions(db, addresses);
  });
}
