import { createCookieSessionStorage, redirect } from "react-router";
import { getEnv } from "./env";

export interface SessionData {
  /** Set on login (#9). */
  userId?: number;
}

export interface SessionFlashData {
  error?: string;
}

const env = getEnv();

export const { getSession, commitSession, destroySession } = createCookieSessionStorage<
  SessionData,
  SessionFlashData
>({
  cookie: {
    name: "__jassmin_session",
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

/** Logs the user out: destroys the session cookie and redirects home. */
export async function logout(request: Request): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/", { headers: { "Set-Cookie": await destroySession(session) } });
}
