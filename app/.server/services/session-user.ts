import { type Db, db } from "../db";
import { findSessionUser, type PublicUser } from "../db/queries/users";
import { getSessionAuth, isSessionRevoked } from "../session";

/**
 * The user the session cookie names, or `null` when logged out, when that user no longer exists,
 * or when a password change after the session logged in revoked it (#135). Its own module so the
 * cart service can use it without importing `./auth` (which imports the cart service).
 */
export async function getSessionUser(
  request: Request,
  database: Db = db,
): Promise<PublicUser | null> {
  const { userId, authenticatedAt } = await getSessionAuth(request);
  if (userId === undefined) return null;
  const user = await findSessionUser(database, userId);
  if (!user || isSessionRevoked(authenticatedAt, user.passwordChangedAt)) return null;
  const { passwordChangedAt: _, ...publicUser } = user;
  return publicUser;
}
