import { randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Argon2id with the library defaults (19 MiB, 2 passes, 1 thread), the OWASP baseline.
// The algorithm and its parameters are stored in the PHC string, so they can change later
// without breaking existing hashes.

/** Hashes a password for `users.password_hash`. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Checks a password against a stored hash; `false` (never a throw) for a malformed hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * A hash of a random password, verified against when a login email is unknown so that the
 * response takes as long as for a wrong password and doesn't reveal which emails have accounts.
 */
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
}
