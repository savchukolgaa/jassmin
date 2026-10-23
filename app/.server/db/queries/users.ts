import { eq, sql } from "drizzle-orm";
import type { UserRole } from "~/lib/enums";
import type { Db } from "../client";
import { users } from "../schema";

/** A user as it may be shown or returned to the app: never includes the password hash. */
export interface PublicUser {
  id: number;
  fullName: string;
  email: string;
  /** Read fresh on every request, so demoting an admin takes effect immediately. */
  role: UserRole;
}

export interface UserCredentials {
  id: number;
  passwordHash: string;
}

export interface NewUser {
  fullName: string;
  /** Already normalised (trimmed, lowercased). */
  email: string;
  passwordHash: string;
  phone?: string | null;
  acquisitionChannel?: string;
  lastLoginAt?: Date;
}

/** Looks up the login credentials for an (already normalised) email. */
export async function findUserByEmail(db: Db, email: string): Promise<UserCredentials | undefined> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user;
}

export async function findUserById(db: Db, id: number): Promise<PublicUser | undefined> {
  const [user] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user;
}

/** Inserts a user. Rejects with PostgreSQL error `23505` when the email is taken. */
export async function insertUser(db: Db, values: NewUser): Promise<{ id: number }> {
  const [user] = await db.insert(users).values(values).returning({ id: users.id });
  if (!user) {
    throw new Error("Inserting the user returned no row");
  }
  return user;
}

/** Records a successful login (`last_login_at` is a churn-model feature). */
export async function touchLastLogin(db: Db, id: number): Promise<void> {
  await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, id));
}

/**
 * Sets the role of the user with this (already normalised) email. `false` when no user has it.
 * Used by `pnpm db:make-admin`.
 */
export async function setUserRole(db: Db, email: string, role: UserRole): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ role })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  return updated.length > 0;
}
