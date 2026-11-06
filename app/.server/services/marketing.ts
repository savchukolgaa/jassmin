// Unsubscribing from marketing email (#139). The link in every cart reminder carries a signed
// token (`unsubscribe-token.ts`); following it and confirming, or the mail client's one-click
// POST (RFC 8058), sets `users.marketing_opt_in = false`. Order emails are not affected.
import type { Db } from "../db/client";
import { setMarketingOptIn } from "../db/queries/users";
import type { MailEnv } from "../env";
import { verifyUnsubscribeToken } from "../unsubscribe-token";

export interface MarketingDeps {
  db: Db;
  env: Pick<MailEnv, "EMAIL_UNSUBSCRIBE_SECRET">;
}

export type UnsubscribeResult = { ok: true } | { ok: false; error: "invalid-token" };

/** The user a token was signed for, or `undefined`; checks nothing in the database. */
export function inspectUnsubscribeToken(
  token: string,
  { env }: Pick<MarketingDeps, "env">,
): number | undefined {
  const secret = env.EMAIL_UNSUBSCRIBE_SECRET;
  return secret ? verifyUnsubscribeToken(token, secret) : undefined;
}

/**
 * Withdraws the token's user from marketing email. Unsubscribing again is fine; a forged token,
 * a missing secret or a deleted user is `invalid-token`.
 */
export async function unsubscribeMarketing(
  token: string,
  deps: MarketingDeps,
): Promise<UnsubscribeResult> {
  const userId = inspectUnsubscribeToken(token, deps);
  if (userId === undefined || !(await setMarketingOptIn(deps.db, userId, false))) {
    return { ok: false, error: "invalid-token" };
  }
  return { ok: true };
}
