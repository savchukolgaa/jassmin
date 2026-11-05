import { and, eq, isNull } from "drizzle-orm";
import type { AuthTokenError } from "~/lib/auth";
import type { AuthTokenPurpose } from "~/lib/enums";
import type { Db } from "../client";
import { authTokens } from "../schema";

// One-time links for password reset and email verification (#135). Tokens are looked up by
// their SHA-256 (`hashAuthToken`); the raw token is never stored.

type Executor = Pick<Db, "select" | "insert" | "update">;

export type AuthTokenCheck = { ok: true; userId: number } | { ok: false; error: AuthTokenError };

interface TokenRow {
  userId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

function classify(row: TokenRow | undefined, now: Date): AuthTokenCheck {
  if (!row) return { ok: false, error: "unknown" };
  if (row.usedAt) return { ok: false, error: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  return { ok: true, userId: row.userId };
}

export async function insertAuthToken(
  db: Executor,
  values: { userId: number; purpose: AuthTokenPurpose; hash: string; expiresAt: Date },
): Promise<void> {
  await db.insert(authTokens).values({
    userId: values.userId,
    purpose: values.purpose,
    tokenHash: values.hash,
    expiresAt: values.expiresAt,
  });
}

function findToken(db: Executor, purpose: AuthTokenPurpose, hash: string) {
  return db
    .select({
      id: authTokens.id,
      userId: authTokens.userId,
      expiresAt: authTokens.expiresAt,
      usedAt: authTokens.usedAt,
    })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hash), eq(authTokens.purpose, purpose)))
    .limit(1);
}

/** Whether the token can be used, without using it: for the page the emailed link opens. */
export async function inspectAuthToken(
  db: Executor,
  purpose: AuthTokenPurpose,
  hash: string,
  now: Date,
): Promise<AuthTokenCheck> {
  const [row] = await findToken(db, purpose, hash);
  return classify(row, now);
}

/**
 * Uses the token up: locks its row, checks it and sets `used_at`. Call it inside the transaction
 * that does what the token allows, so two submits of one link can't both succeed and a failed
 * write leaves the token usable.
 */
export async function consumeAuthToken(
  tx: Executor,
  purpose: AuthTokenPurpose,
  hash: string,
  now: Date,
): Promise<AuthTokenCheck> {
  const [row] = await findToken(tx, purpose, hash).for("update");
  const check = classify(row, now);
  if (check.ok && row) {
    await tx.update(authTokens).set({ usedAt: now }).where(eq(authTokens.id, row.id));
  }
  return check;
}

/** Marks every unused token of this user and purpose as used, e.g. after a reset. */
export async function invalidateUserTokens(
  tx: Executor,
  userId: number,
  purpose: AuthTokenPurpose,
  now: Date,
): Promise<void> {
  await tx
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
      ),
    );
}
