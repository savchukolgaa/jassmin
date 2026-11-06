import { data, redirect } from "react-router";
import { loginRedirectPath } from "~/lib/auth";
import {
  linkVisitorToUser,
  type RequestArgs,
  readVisitor,
  trackEvent,
  visitorContext,
} from "../analytics";
import { type Db, db } from "../db";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import { findUserByEmail, insertUser, type PublicUser, touchLastLogin } from "../db/queries/users";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "../password";
import { pageUrl } from "../request-url";
import { mergeGuestCart } from "./cart";
import { getSessionUser } from "./session-user";

export type { PublicUser } from "../db/queries/users";

/**
 * The logged-in user, or `null` when logged out, when the session's user no longer exists, or
 * when a password change revoked the session (#135).
 */
export async function getUser(request: Request, database: Db = db): Promise<PublicUser | null> {
  return getSessionUser(request, database);
}

/**
 * The logged-in user. For protected loaders and actions: when logged out, throws a redirect to
 * `/login?redirectTo=<this page>`, so the user comes back here after logging in: the page, not the
 * `.data` URL a client-side navigation requests (#112).
 */
export async function requireUser(request: Request, database: Db = db): Promise<PublicUser> {
  const user = await getUser(request, database);
  if (!user) {
    throw redirect(loginRedirectPath(pageUrl(request)));
  }
  return user;
}

/**
 * The logged-in admin, for admin-only endpoints (the in-app `/admin` area was replaced by the
 * Strapi admin in #40). Call it in every such loader **and** action: logged out → redirect to login like `requireUser`; logged in without
 * the `admin` role → 403. The role comes from the database on every call, never from the cookie.
 */
export async function requireAdmin(request: Request, database: Db = db): Promise<PublicUser> {
  const user = await requireUser(request, database);
  if (user.role !== "admin") {
    throw data(null, { status: 403 });
  }
  return user;
}

export interface Registration {
  fullName: string;
  /** Already normalised (trimmed, lowercased). */
  email: string;
  password: string;
  phone?: string;
  /** `undefined` keeps the column default `'direct'`. */
  acquisitionChannel?: string;
  /** Ticked the marketing emails box (#128); `undefined` keeps the column default `false`. */
  marketingOptIn?: boolean;
}

export type RegisterResult = { ok: true; userId: number } | { ok: false; error: "email_taken" };

/**
 * Creates an account with a hashed password. Registering logs the user in, so `last_login_at`
 * is set too.
 */
export async function registerUser(database: Db, input: Registration): Promise<RegisterResult> {
  if (await findUserByEmail(database, input.email)) {
    return { ok: false, error: "email_taken" };
  }

  try {
    const { id } = await insertUser(database, {
      fullName: input.fullName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phone: input.phone ?? null,
      acquisitionChannel: input.acquisitionChannel,
      marketingOptIn: input.marketingOptIn,
      lastLoginAt: new Date(),
    });
    return { ok: true, userId: id };
  } catch (error: unknown) {
    // Two sign-ups with the same email raced past the check above.
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return { ok: false, error: "email_taken" };
    }
    throw error;
  }
}

export type LoginResult = { ok: true; userId: number } | { ok: false };

/**
 * Checks an (already normalised) email and password and records the login in `last_login_at`.
 * An unknown email and a wrong password give the same result in about the same time.
 */
export async function verifyLogin(
  database: Db,
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await findUserByEmail(database, email);
  if (!user) {
    await verifyPassword(await getDummyPasswordHash(), password);
    return { ok: false };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return { ok: false };
  }

  await touchLastLogin(database, user.id);
  return { ok: true, userId: user.id };
}

/**
 * Runs after every successful login or registration, before the session cookie is set: merges
 * the guest cart into the user's (#10), gives the visitor's anonymous analytics sessions and
 * events to the user (with their first-touch source) and records the `login` event (#18). Each
 * part catches its own errors: none of them may make logging in fail.
 */
export async function onUserAuthenticated(
  args: RequestArgs,
  userId: number,
  /** `password_reset`: logged in by setting a new password with a reset link (#135). */
  kind: "login" | "register" | "password_reset",
): Promise<void> {
  const { request, context } = args;
  let anonymousId: string | undefined;
  try {
    anonymousId =
      context.get(visitorContext)?.anonymousId ?? (await readVisitor(request)).anonymousId;
  } catch (error: unknown) {
    console.error("Reading the visitor failed", error);
  }
  if (!anonymousId) {
    return;
  }

  try {
    await mergeGuestCart(userId, anonymousId);
  } catch (error: unknown) {
    console.error("Merging the guest cart failed", error);
  }
  try {
    await linkVisitorToUser(anonymousId, userId);
  } catch (error: unknown) {
    console.error("Linking the analytics visitor failed", error);
  }
  // The auth cookie isn't on this request yet, hence `userId`. Only with analytics consent.
  await trackEvent(args, "login", { userId, properties: { method: kind } });
}
