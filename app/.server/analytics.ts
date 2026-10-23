// Analytics visitor identity: the `anonymous_id` cookie and the current `sessions` row.
//
// Minimal version for guest carts (#10). #18 extends it (30-minute session windows, traffic
// source, device type, `trackEvent`, `linkVisitorToUser`); keep the function signatures and the
// cookie names stable so it can build on them.
import { randomUUID } from "node:crypto";
import { type CookieOptions, createCookie } from "react-router";
import { z } from "zod";
import { db as defaultDb } from "./db";
import type { Db } from "./db/client";
import { hasVisitorSession, insertSession } from "./db/queries/analytics";
import { getEnv } from "./env";
import { ANALYTICS_SESSION_COOKIE, ANONYMOUS_ID_COOKIE } from "./visitor-cookie";

const env = getEnv();

// Signed, so a visitor can't pick another visitor's id (and so read their guest cart).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: env.NODE_ENV === "production",
  secrets: [env.SESSION_SECRET],
};

const anonymousIdCookie = createCookie(ANONYMOUS_ID_COOKIE, {
  ...cookieOptions,
  maxAge: 60 * 60 * 24 * 365,
});

// No `maxAge`: lasts for the browser session. #18 adds the 30-minute inactivity window.
const analyticsSessionCookie = createCookie(ANALYTICS_SESSION_COOKIE, cookieOptions);

const idSchema = z.uuid();

async function parseId(
  cookie: typeof anonymousIdCookie,
  header: string | null,
): Promise<string | undefined> {
  // `null` for a missing cookie or a bad signature.
  const value: unknown = await cookie.parse(header);
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export interface VisitorCookies {
  anonymousId?: string;
  sessionId?: string;
}

/** The visitor's ids from their cookies, without creating anything. For loaders. */
export async function readVisitor(request: Request): Promise<VisitorCookies> {
  const header = request.headers.get("Cookie");
  const [anonymousId, sessionId] = await Promise.all([
    parseId(anonymousIdCookie, header),
    parseId(analyticsSessionCookie, header),
  ]);
  return { anonymousId, sessionId };
}

export interface Visitor {
  anonymousId: string;
  /** The current `sessions.session_id`. */
  sessionId: string;
  /** `Set-Cookie` headers to send with the response; empty when nothing changed. */
  headers: Headers;
}

/**
 * The visitor's ids, creating the anonymous id and the `sessions` row when they're missing. For
 * actions that need a session to write to (the cart); send `headers` with the response.
 */
export async function getVisitor(request: Request, db: Db = defaultDb): Promise<Visitor> {
  const cookies = await readVisitor(request);
  const headers = new Headers();

  let anonymousId = cookies.anonymousId;
  if (!anonymousId) {
    anonymousId = randomUUID();
    headers.append("Set-Cookie", await anonymousIdCookie.serialize(anonymousId));
  }

  let sessionId = cookies.sessionId;
  if (!sessionId || !(await hasVisitorSession(db, sessionId, anonymousId))) {
    sessionId = await insertSession(db, {
      anonymousId,
      landingPage: new URL(request.url).pathname,
    });
    headers.append("Set-Cookie", await analyticsSessionCookie.serialize(sessionId));
  }

  return { anonymousId, sessionId, headers };
}
