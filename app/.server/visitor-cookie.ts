// Names of the analytics visitor cookies set by `analytics.ts`. Kept apart from it, because it
// reads the env on import, so env-free code (e.g. `hasSessionCookie`) can check for them.

/** Persistent visitor id (`sessions.anonymous_id`), kept for a year. */
export const ANONYMOUS_ID_COOKIE = "anonymous_id";

/** The visitor's current analytics session (`sessions.session_id`). */
export const ANALYTICS_SESSION_COOKIE = "analytics_session";
