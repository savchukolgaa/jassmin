// Brevo's webhook events (#134) as the shop's email events: which ones suppress an address, and
// which order email they're about. Switching providers means a new adapter like this one.
import type { EmailSuppressionReason } from "~/lib/enums";
import { parseOrderEmailTag } from "../services/order-email";
import type { BrevoEvent } from "./webhook-brevo.schema";

/** An address that must get no more email, and the sent message it's about. */
export interface EmailEvent {
  address: string;
  reason: EmailSuppressionReason;
  detail: string | null;
  /** The `order_emails` row, from our `X-Mailin-custom` tag. */
  orderEmailId?: number;
  messageId?: string;
}

/**
 * Brevo event → suppression reason. Everything else (`soft_bounce`, `deferred`, `delivered`,
 * opens, clicks, `unsubscribed`, unknown events) is acknowledged and ignored.
 */
const SUPPRESSING_EVENTS: Readonly<Record<string, EmailSuppressionReason>> = {
  hard_bounce: "hard_bounce",
  spam: "complaint",
  blocked: "blocked",
  invalid_email: "invalid",
};

/** The events that suppress an address, in the order received. */
export function toEmailEvents(events: readonly BrevoEvent[]): EmailEvent[] {
  return events.flatMap((event): EmailEvent[] => {
    const reason = Object.hasOwn(SUPPRESSING_EVENTS, event.event)
      ? SUPPRESSING_EVENTS[event.event]
      : undefined;
    if (!reason) return [];
    const orderEmailId = parseOrderEmailTag(event["X-Mailin-custom"]);
    const messageId = event["message-id"]?.trim();
    return [
      {
        address: event.email,
        reason,
        detail: event.reason?.trim() || null,
        ...(orderEmailId !== undefined ? { orderEmailId } : {}),
        ...(messageId ? { messageId } : {}),
      },
    ];
  });
}
