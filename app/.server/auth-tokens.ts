import { createHash, randomBytes } from "node:crypto";

// One-time tokens for the links in password reset and email verification emails (#135). The
// token is 32 random bytes in base64url (43 characters, 256 bits); only its SHA-256 is stored.
// A random token needs no salt or slow hash: nobody can guess one to look up.

/** Characters in a token: 32 bytes in unpadded base64url. */
export const AUTH_TOKEN_LENGTH = 43;

/** The hex SHA-256 of a token: what `auth_tokens.token_hash` stores and lookups use. */
export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new token for an emailed link, and the hash to store. */
export function generateAuthToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAuthToken(token) };
}
