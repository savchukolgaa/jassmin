// Analytics visitors and behavioural events (#10, #18): the `anonymous_id` cookie, the current
// `sessions` row (a new one after 30 minutes without a request) and the `user_events` stream.
//
// Tracking only runs once the visitor accepted analytics cookies (`isTrackingAllowed`). Without
// consent a session row is still created when the guest cart needs one, but it holds no traffic
// source, device or landing page, and no events are recorded. Tracking never throws: a failed
// insert is logged and the page carries on.
import { randomUUID } from "node:crypto";
import { isbot } from "isbot";
import {
  type CookieOptions,
  createContext,
  createCookie,
  type RouterContextProvider,
} from "react-router";
import { z } from "zod";
import {
  type EventProperties,
  resolveDeviceType,
  resolveTrafficAttribution,
} from "~/lib/analytics";
import { parseEventProperties } from "~/lib/analytics.schema";
import type { EventType } from "~/lib/enums";
import { getConsent } from "./consent";
import { db as defaultDb } from "./db";
import type { Db } from "./db/client";
import {
  fillFirstTouch,
  insertEvents,
  insertSession,
  linkAnonymousRows,
  type NewUserEvent,
  type SessionAttribution,
  touchActiveSession,
} from "./db/queries/analytics";
import { getEnv } from "./env";
import { getUserId } from "./session";
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

// No `maxAge`: lasts for the browser session. The 30-minute inactivity window is checked on the
// server (`touchActiveSession`).
const analyticsSessionCookie = createCookie(ANALYTICS_SESSION_COOKIE, cookieOptions);

const idSchema = z.uuid();

/** Longest `landing_page` and `referrer` stored. */
const MAX_URL_LENGTH = 500;

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

/** The visitor's ids from their cookies, without creating anything. */
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
  /** Where the current visit came from; all `null` for a session started without consent. */
  attribution: SessionAttribution;
  /** `Set-Cookie` headers to send with the response; empty when nothing changed. */
  headers: Headers;
}

export interface GetVisitorOptions {
  /** Whether a new session records the traffic source, device and landing page (consent). */
  track?: boolean;
}

const UNTRACKED: SessionAttribution = {
  trafficSource: null,
  trafficMedium: null,
  trafficCampaign: null,
};

/** Whether the request's UTM tags start another visit than the session's (a new campaign click). */
function startsNewVisit(url: URL, attribution: SessionAttribution): boolean {
  const utmSource = url.searchParams.get("utm_source")?.trim().toLowerCase();
  return Boolean(utmSource) && utmSource !== attribution.trafficSource;
}

/**
 * The visitor's ids, creating the anonymous id and the `sessions` row when they're missing, and a
 * new session after `SESSION_TIMEOUT_MINUTES` without a request. Send `headers` with the response
 * (the `_shop` middleware does it for visitors in `visitorContext`).
 */
export async function getVisitor(
  request: Request,
  db: Db = defaultDb,
  { track = true }: GetVisitorOptions = {},
): Promise<Visitor> {
  const cookies = await readVisitor(request);
  const headers = new Headers();
  const url = new URL(request.url);

  let anonymousId = cookies.anonymousId;
  if (!anonymousId) {
    anonymousId = randomUUID();
    headers.append("Set-Cookie", await anonymousIdCookie.serialize(anonymousId));
  }

  if (cookies.sessionId) {
    const attribution = await touchActiveSession(db, cookies.sessionId, anonymousId);
    // A session started without consent is replaced once tracking is allowed, so the visit gets
    // its source and device.
    const keep =
      attribution !== undefined &&
      !(track && (attribution.trafficSource === null || startsNewVisit(url, attribution)));
    if (keep) {
      return { anonymousId, sessionId: cookies.sessionId, attribution, headers };
    }
  }

  let attribution = UNTRACKED;
  let details = {};
  if (track) {
    const traffic = resolveTrafficAttribution(url, request.headers.get("Referer"));
    attribution = {
      trafficSource: traffic.source,
      trafficMedium: traffic.medium,
      trafficCampaign: traffic.campaign,
    };
    details = {
      ...attribution,
      landingPage: (url.pathname + url.search).slice(0, MAX_URL_LENGTH),
      deviceType: resolveDeviceType(request.headers.get("User-Agent")),
      userId: (await getUserId(request)) ?? null,
    };
  }
  const sessionId = await insertSession(db, { anonymousId, ...details });
  headers.append("Set-Cookie", await analyticsSessionCookie.serialize(sessionId));
  return { anonymousId, sessionId, attribution, headers };
}

/** A `Set-Cookie` header that ends the analytics session cookie (consent withdrawn). */
export function clearAnalyticsSession(): Promise<string> {
  return analyticsSessionCookie.serialize("", { maxAge: 0 });
}

/**
 * The request's visitor, set by the `_shop` middleware when tracking is allowed, or by
 * `ensureVisitor`. `null` for bots, visitors without consent and failed lookups.
 */
export const visitorContext = createContext<Visitor | null>(null);

/** What `trackEvent` and `ensureVisitor` need from loader, action or middleware args. */
export interface RequestArgs {
  request: Request;
  context: Readonly<RouterContextProvider>;
}

/** Whether events may be recorded: the visitor accepted analytics cookies and isn't a bot. */
export async function isTrackingAllowed(request: Request): Promise<boolean> {
  if (isbot(request.headers.get("User-Agent"))) {
    return false;
  }
  return (await getConsent(request)) === "granted";
}

/** A full page load (not a client navigation's `.data` request or a form post). */
export function isDocumentRequest(request: Request): boolean {
  if (request.method !== "GET" || new URL(request.url).pathname.endsWith(".data")) {
    return false;
  }
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) {
    return dest === "document";
  }
  return request.headers.get("Accept")?.includes("text/html") ?? false;
}

/**
 * The visitor from `visitorContext`, or a new one stored there, for actions that need a session to
 * write to (the guest cart) even without analytics consent.
 */
export async function ensureVisitor(
  { request, context }: RequestArgs,
  db: Db = defaultDb,
): Promise<Visitor> {
  const existing = context.get(visitorContext);
  if (existing) {
    return existing;
  }
  const visitor = await getVisitor(request, db, { track: await isTrackingAllowed(request) });
  context.set(visitorContext, visitor);
  return visitor;
}

export interface TrackEventOptions<T extends EventType = EventType> {
  /** `products.id`, for events about one product. */
  productId?: number;
  /** The event's details, as its type's contract says (`EventPropertiesMap`, #129). */
  properties: EventProperties<T>;
  /** The user, when the auth cookie isn't on this request yet (right after logging in). */
  userId?: number;
}

/** One event to record with `trackEvents`. */
export interface EventInput<T extends EventType = EventType>
  extends Omit<TrackEventOptions<T>, "userId"> {
  type: T;
  /** The previous page, when the request's `Referer` isn't it (beacons from the client tracker). */
  referrer?: string;
}

/**
 * Records events for a visitor without checking consent (callers do). Each event's properties are
 * checked against its type's contract (`parseEventProperties`); an event that doesn't match is
 * logged and dropped, and the others are still recorded. Never throws: tracking must not break a
 * page, the cart or login.
 */
export async function trackEvents(
  visitor: Visitor,
  request: Request,
  events: EventInput[],
  { userId, db = defaultDb }: { userId?: number; db?: Db } = {},
): Promise<void> {
  try {
    const user = userId ?? (await getUserId(request)) ?? null;
    const shared = {
      userId: user,
      anonymousId: visitor.anonymousId,
      sessionId: visitor.sessionId,
      source: visitor.attribution.trafficSource,
      medium: visitor.attribution.trafficMedium,
      campaign: visitor.attribution.trafficCampaign,
      deviceType: resolveDeviceType(request.headers.get("User-Agent")),
      referrer: request.headers.get("Referer")?.slice(0, MAX_URL_LENGTH) ?? null,
    };
    const rows: NewUserEvent[] = [];
    for (const event of events) {
      const properties = parseEventProperties(event.type, event.properties);
      if (properties === null) {
        console.error(`Dropping a ${event.type} event whose properties don't match its contract`);
        continue;
      }
      rows.push({
        ...shared,
        eventType: event.type,
        productId: event.productId ?? null,
        eventProperties: properties,
        ...(event.referrer && { referrer: event.referrer.slice(0, MAX_URL_LENGTH) }),
      });
    }
    if (rows.length > 0) {
      await insertEvents(db, rows);
    }
  } catch (error: unknown) {
    console.error("Recording analytics events failed", error);
  }
}

/**
 * Records one event for the request's visitor, if tracking is allowed. Never throws; call it with
 * `void trackEvent(…)` so the response doesn't wait for the insert.
 */
export async function trackEvent<T extends EventType>(
  { request, context }: RequestArgs,
  type: T,
  { userId, ...event }: TrackEventOptions<T>,
  db: Db = defaultDb,
): Promise<void> {
  try {
    const visitor = context.get(visitorContext);
    if (!visitor || !(await isTrackingAllowed(request))) {
      return;
    }
    await trackEvents(visitor, request, [{ type, ...event }], { userId, db });
  } catch (error: unknown) {
    console.error(`Recording the ${type} event failed`, error);
  }
}

/**
 * Gives the visitor's anonymous sessions and events to the user who just logged in or registered,
 * and stores where the person first came from (`users.first_touch_*`) if it isn't set yet.
 */
export async function linkVisitorToUser(
  anonymousId: string,
  userId: number,
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    await linkAnonymousRows(tx, anonymousId, userId);
    await fillFirstTouch(tx, anonymousId, userId);
  });
}
