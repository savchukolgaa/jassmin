// Bounces and spam complaints from the email provider (#134): `/hooks/email` hands the parsed
// events here. In one transaction each address is suppressed (`email_suppressions`) and the sent
// order email it's about is marked `failed` with the reason.
import { type Db, db } from "../db";
import { suppressEmails } from "../db/queries/email-suppressions";
import { markOrderEmailBounced } from "../db/queries/order-emails";
import type { EmailEvent } from "../email/webhook-brevo";

/** `last_error` keeps at most this many characters. */
const MAX_ERROR_LENGTH = 500;

export interface EmailEventsResult {
  /** Addresses that weren't suppressed before. */
  suppressed: number;
  /** Sent order emails now marked `failed`. */
  bounced: number;
}

/** Records the events. An event that matches no order email only suppresses its address. */
export async function applyEmailEvents(
  events: readonly EmailEvent[],
  database: Db = db,
): Promise<EmailEventsResult> {
  if (events.length === 0) return { suppressed: 0, bounced: 0 };
  return database.transaction(async (tx) => {
    const suppressed = await suppressEmails(tx, events);
    let bounced = 0;
    for (const { reason, detail, orderEmailId, messageId } of events) {
      if (orderEmailId === undefined && messageId === undefined) continue;
      const error = (detail ? `${reason}: ${detail}` : reason).slice(0, MAX_ERROR_LENGTH);
      bounced += await markOrderEmailBounced(
        tx,
        orderEmailId !== undefined ? { orderEmailId, error } : { messageId, error },
      );
    }
    return { suppressed, bounced };
  });
}
