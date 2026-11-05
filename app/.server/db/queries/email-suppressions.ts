// Addresses that get no more email (#134): written by the email provider's webhook, read before
// every send (`withSuppressions` in `mail.ts`).
import { inArray } from "drizzle-orm";
import type { EmailSuppressionReason } from "~/lib/enums";
import type { Db } from "../client";
import { emailSuppressions } from "../schema";

/** A `Db` or a transaction, so the webhook service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert">;

/** `detail` keeps at most this many characters. */
const MAX_DETAIL_LENGTH = 500;

export interface EmailSuppressionEntry {
  address: string;
  reason: EmailSuppressionReason;
  detail?: string | null | undefined;
}

/** The address as stored and compared: trimmed and lowercase. */
export function normalizeSuppressedAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Stops email to these addresses. An address already suppressed keeps its first reason. Returns
 * how many addresses were new.
 */
export async function suppressEmails(
  db: Executor,
  entries: readonly EmailSuppressionEntry[],
): Promise<number> {
  const rows = new Map<string, typeof emailSuppressions.$inferInsert>();
  for (const { address, reason, detail } of entries) {
    const normalized = normalizeSuppressedAddress(address);
    if (normalized && !rows.has(normalized)) {
      rows.set(normalized, {
        address: normalized,
        reason,
        detail: detail ? detail.slice(0, MAX_DETAIL_LENGTH) : null,
      });
    }
  }
  if (rows.size === 0) return 0;
  const inserted = await db
    .insert(emailSuppressions)
    .values([...rows.values()])
    .onConflictDoNothing({ target: emailSuppressions.address })
    .returning({ address: emailSuppressions.address });
  return inserted.length;
}

/** Which of `addresses` are suppressed, keyed by the lowercase address, with the reason. */
export async function findEmailSuppressions(
  db: Pick<Db, "select">,
  addresses: readonly string[],
): Promise<Map<string, EmailSuppressionReason>> {
  const normalized = [...new Set(addresses.map(normalizeSuppressedAddress))].filter(Boolean);
  if (normalized.length === 0) return new Map();
  const rows = await db
    .select({ address: emailSuppressions.address, reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.address, normalized));
  return new Map(rows.map((row) => [row.address, row.reason]));
}
