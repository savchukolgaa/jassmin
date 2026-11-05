import { createCookieSessionStorage, redirect } from "react-router";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { getEnv } from "./env";
import { SESSION_COOKIE_NAME } from "./session-cookie";

export interface SessionData {
  /** Set on login (#9). */
  userId?: number;
  /**
   * When this session logged in, in epoch ms (#135). A password change after it revokes the
   * session (`isSessionRevoked`). Cookies from before #135 have none.
   */
  authenticatedAt?: number;
  /** Orders placed in this browser (#11), newest first, so a guest can open their success page. */
  orderIds?: number[];
  /** Gift cards bought in this browser (#125), newest first, so a guest can open their page. */
  giftCardIds?: number[];
}

/** How many placed orders (and bought gift cards) the session remembers. */
const MAX_SESSION_ORDERS = 10;

export interface SessionFlashData {
  error?: string;
}

const env = getEnv();

export const { getSession, commitSession, destroySession } = createCookieSessionStorage<
  SessionData,
  SessionFlashData
>({
  cookie: {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.NODE_ENV === "production",
    secrets: [env.SESSION_SECRET],
    maxAge: 60 * 60 * 24 * 30,
  },
});

/** The logged-in user's id from the session cookie, without checking that the user exists. */
export async function getUserId(request: Request): Promise<number | undefined> {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("userId");
}

/** The logged-in user's id and when the session logged in, from the cookie only. */
export async function getSessionAuth(
  request: Request,
): Promise<{ userId: number | undefined; authenticatedAt: number | undefined }> {
  const session = await getSession(request.headers.get("Cookie"));
  return { userId: session.get("userId"), authenticatedAt: session.get("authenticatedAt") };
}

/**
 * Whether a password change revoked this session (#135): the password changed after the session
 * logged in. A session without `authenticatedAt` (from before #135) is valid until the user's
 * first password change.
 */
export function isSessionRevoked(
  authenticatedAt: number | undefined,
  passwordChangedAt: Date | null,
): boolean {
  if (passwordChangedAt === null) return false;
  return authenticatedAt === undefined || authenticatedAt < passwordChangedAt.getTime();
}

/**
 * Keeps this session logged in after its own password change (#135): sets `authenticatedAt` to the
 * change time. Returns the `Set-Cookie` header value.
 */
export async function renewSessionAuth(request: Request, authenticatedAt: Date): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("authenticatedAt", authenticatedAt.getTime());
  return commitSession(session);
}

/** The orders placed in this browser, newest first. */
export async function getSessionOrderIds(request: Request): Promise<number[]> {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("orderIds") ?? [];
}

/** Remembers an order placed in this browser; returns the `Set-Cookie` header value. */
export async function rememberOrder(request: Request, orderId: number): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  const others = (session.get("orderIds") ?? []).filter((id) => id !== orderId);
  session.set("orderIds", [orderId, ...others].slice(0, MAX_SESSION_ORDERS));
  return commitSession(session);
}

/** The gift cards bought in this browser, newest first (#125). */
export async function getSessionGiftCardIds(request: Request): Promise<number[]> {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("giftCardIds") ?? [];
}

/** Remembers a gift card bought in this browser; returns the `Set-Cookie` header value. */
export async function rememberGiftCard(request: Request, giftCardId: number): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  const others = (session.get("giftCardIds") ?? []).filter((id) => id !== giftCardId);
  session.set("giftCardIds", [giftCardId, ...others].slice(0, MAX_SESSION_ORDERS));
  return commitSession(session);
}

/** Logs the user in: stores their id in the session cookie and redirects. */
export async function createUserSession({
  request,
  userId,
  redirectTo,
  authenticatedAt = new Date(),
}: {
  request: Request;
  userId: number;
  /** Must already be safe, see `safeRedirect`. */
  redirectTo: string;
  /**
   * When the session logs in. After a password reset, pass the time stored in
   * `users.password_changed_at`, so the new session survives the revocation check.
   */
  authenticatedAt?: Date;
}): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("userId", userId);
  session.set("authenticatedAt", authenticatedAt.getTime());
  return redirect(redirectTo, { headers: { "Set-Cookie": await commitSession(session) } });
}

/** Logs the user out: destroys the session cookie and redirects to the home page in `locale`. */
export async function logout(request: Request, locale: Locale = DEFAULT_LOCALE): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect(pathFor(locale, "home"), {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}
