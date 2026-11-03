// App-level types and pure helpers for the analytics tables (`sessions` and `user_events` in
// app/.server/db/schema.ts). No server imports, so both server and client code can import them.
//
// These are visitor sessions for traffic and conversion analysis, not the auth cookie session
// (app/.server/session.ts).
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { resolveAcquisitionChannel } from "./auth";
import type { EventType } from "./enums";
import { crossesLocale } from "./paths";

/** Free-form event details stored as `jsonb`, e.g. the search query or the cart quantity. */
export type EventProperties = Record<string, unknown>;

export interface AnalyticsSession {
  sessionId: string;
  /** `null` until the visitor logs in or registers. */
  userId: number | null;
  /** Visitor id from the `anonymous_id` cookie, set before signup. */
  anonymousId: string;
  startedAt: Date;
  /** Time of the last request in the session. */
  endedAt: Date | null;
  landingPage: string | null;
  trafficSource: string | null;
  trafficMedium: string | null;
  trafficCampaign: string | null;
  deviceType: string | null;
}

export interface UserEvent {
  eventId: string;
  /** `null` until the visitor logs in or registers. */
  userId: number | null;
  anonymousId: string;
  sessionId: string;
  eventType: EventType;
  /** `null` for events that aren't about a product, or once the product has been deleted. */
  productId: number | null;
  eventProperties: EventProperties | null;
  /** UTM source, medium and campaign. */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  deviceType: string | null;
  referrer: string | null;
  createdAt: Date;
}

/** An analytics session ends after this many minutes without a request (#18). */
export const SESSION_TIMEOUT_MINUTES = 30;

export const DEVICE_TYPES = ["mobile", "tablet", "desktop"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

// Tablets first: Android tablets don't say "Mobile", Android phones do.
const TABLET_UA = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i;
const MOBILE_UA = /Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i;

/** The device type from a `User-Agent` header; `null` when there is none. */
export function resolveDeviceType(userAgent: string | null): DeviceType | null {
  if (!userAgent) {
    return null;
  }
  if (TABLET_UA.test(userAgent)) {
    return "tablet";
  }
  return MOBILE_UA.test(userAgent) ? "mobile" : "desktop";
}

/** Where a visit came from, stored on `sessions` and copied onto each of its events. */
export interface TrafficAttribution {
  /** `utm_source`, else the external referrer's host, else `"direct"`. */
  source: string;
  /** `utm_medium`; without UTM tags `"referral"` (external referrer) or `"none"`. */
  medium: string | null;
  /** `utm_campaign`, if any. */
  campaign: string | null;
}

function utmParam(url: URL, name: string): string | null {
  return url.searchParams.get(name)?.trim().toLowerCase().slice(0, 100) || null;
}

/**
 * The traffic attribution of a visit that starts with this request. `source` follows the rules of
 * `users.acquisition_channel` (`resolveAcquisitionChannel`).
 */
export function resolveTrafficAttribution(url: URL, referer: string | null): TrafficAttribution {
  const source = resolveAcquisitionChannel(url, referer);
  const campaign = utmParam(url, "utm_campaign");
  if (utmParam(url, "utm_source")) {
    return { source, medium: utmParam(url, "utm_medium"), campaign };
  }
  return { source, medium: source === "direct" ? "none" : "referral", campaign };
}

/** Event types the browser may send to `/api/events`; the rest are only recorded by the server. */
export const CLIENT_EVENT_TYPES = ["page_view"] as const satisfies readonly EventType[];

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

/** Most events one `/api/events` request may carry. */
export const MAX_CLIENT_EVENTS = 20;

export type { ClientEvent, ClientEventBatch } from "./analytics.schema";

/**
 * `shouldRevalidate` for routes whose loader records a view (`product_view`, `search`): a form
 * post (cart, language switch, cookie banner) doesn't change their data, and reloading them would
 * record the same view twice. Navigations still load as usual, and switching the language always
 * reloads (#112).
 */
export function shouldRevalidateView({
  formMethod,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (crossesLocale({ currentUrl, nextUrl })) {
    return true;
  }
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    return false;
  }
  return defaultShouldRevalidate;
}
