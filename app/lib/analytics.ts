// App-level types for the analytics tables (`sessions` and `user_events` in
// app/.server/db/schema.ts). Plain data only, so both server and client code can import them.
//
// These are visitor sessions for traffic and conversion analysis, not the auth cookie session
// (app/.server/session.ts).
import type { EventType } from "./enums";

/** Free-form event details stored as `jsonb`, e.g. the search query or the cart quantity. */
export type EventProperties = Record<string, unknown>;

export interface AnalyticsSession {
  sessionId: string;
  /** `null` until the visitor logs in or registers. */
  userId: number | null;
  /** Visitor id from the `anonymous_id` cookie, set before signup. */
  anonymousId: string;
  startedAt: Date;
  endedAt: Date | null;
  landingPage: string | null;
  trafficSource: string | null;
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
