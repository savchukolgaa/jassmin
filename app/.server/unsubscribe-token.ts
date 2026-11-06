// Signed unsubscribe tokens for marketing emails (#139). A token names a user and carries an
// HMAC of their id under `EMAIL_UNSUBSCRIBE_SECRET`, so nothing is stored: the same link works
// in every email to that user (a retried email rebuilds the same URL), never expires, and
// unsubscribing twice is harmless. Changing the secret breaks every link already sent.
// Env-free: the secret is passed in, so the reminder job and the web app share it.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Bumped if the token's meaning ever changes, so old signatures stop matching. */
const PURPOSE = "unsubscribe:v1:";

/** The longest user id part a token may have (PostgreSQL `serial` fits in 10 digits). */
const MAX_ID_DIGITS = 10;

function sign(userId: number, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${PURPOSE}${userId}`).digest();
}

/** The token for `userId`'s unsubscribe link: `<user id>.<base64url HMAC-SHA256>`. */
export function createUnsubscribeToken(userId: number, secret: string): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error(`Unsubscribe tokens need a positive user id, got ${userId}`);
  }
  return `${userId}.${sign(userId, secret).toString("base64url")}`;
}

/** The user id a token was signed for, or `undefined` when it is malformed or forged. */
export function verifyUnsubscribeToken(token: string, secret: string): number | undefined {
  const match = /^([1-9]\d*)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match?.[1] || !match[2] || match[1].length > MAX_ID_DIGITS) {
    return undefined;
  }
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId)) {
    return undefined;
  }
  const given = Buffer.from(match[2], "base64url");
  const expected = sign(userId, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined;
  }
  return userId;
}
