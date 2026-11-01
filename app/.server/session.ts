import { createCookieSessionStorage, redirect } from "react-router";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { getEnv } from "./env";
import { SESSION_COOKIE_NAME } from "./session-cookie";

export interface SessionData {
  /** Set on login (#9). */
  userId?: number;
  /** Orders placed in this browser (#11), newest first, so a guest can open their success page. */
  orderIds?: number[];
}

/** How many placed orders the session remembers. */
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

/** Logs the user in: stores their id in the session cookie and redirects. */
export async function createUserSession({
  request,
  userId,
  redirectTo,
}: {
  request: Request;
  userId: number;
  /** Must already be safe, see `safeRedirect`. */
  redirectTo: string;
}): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("userId", userId);
  return redirect(redirectTo, { headers: { "Set-Cookie": await commitSession(session) } });
}

/** Logs the user out: destroys the session cookie and redirects to the home page in `locale`. */
export async function logout(request: Request, locale: Locale = DEFAULT_LOCALE): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect(pathFor(locale, "home"), {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}
