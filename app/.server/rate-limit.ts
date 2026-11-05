// Fixed-window rate limiting (#143). The app's limiters keep their counters in PostgreSQL
// (`rate_limits`), so they survive restarts and deploys and are shared by every instance. An
// in-memory store remains for `/csp-report`, where a flood of reports mustn't become a flood of
// writes, and for unit tests.
import { createHash } from "node:crypto";
import type { Db } from "./db/client";
import { deleteRateLimit, hitRateLimit, readRateLimit } from "./db/queries/rate-limits";

/** Where a limiter keeps its windows. Keys arrive already prefixed and hashed. */
export interface RateLimitStore {
  /** Counts one hit; a missing or ended window restarts at 1 and ends `windowMs` after `now`. */
  hit(key: string, windowMs: number, now: Date): Promise<void>;
  /** The key's window, possibly ended, or `undefined`. */
  read(key: string): Promise<{ count: number; resetAt: Date } | undefined>;
  delete(key: string): Promise<void>;
}

export interface RateLimiterOptions {
  /** Keeps the limiters apart in a shared store, e.g. `login-email`. */
  name: string;
  /** Hits allowed per key within one window. */
  limit: number;
  windowMs: number;
  store: RateLimitStore;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface RateLimiter {
  /** Whether the key has used up its hits in the current window. */
  isBlocked(key: string): Promise<boolean>;
  /** Counts one hit (e.g. a failed login) for the key. */
  hit(key: string): Promise<void>;
  /** Forgets the key's hits (e.g. after a successful login). */
  reset(key: string): Promise<void>;
}

/**
 * The stored key: the limiter's name and a SHA-256 of the key, so emails and IPs never sit in the
 * table in plain text.
 */
export function storedKey(name: string, key: string): string {
  return `${name}:${createHash("sha256").update(key).digest("hex")}`;
}

export function createRateLimiter({
  name,
  limit,
  windowMs,
  store,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  return {
    async isBlocked(key) {
      const window = await store.read(storedKey(name, key));
      return window !== undefined && window.resetAt.getTime() > now() && window.count >= limit;
    },
    async hit(key) {
      await store.hit(storedKey(name, key), windowMs, new Date(now()));
    },
    async reset(key) {
      await store.delete(storedKey(name, key));
    },
  };
}

/** Windows in this process only: they reset on restart and aren't shared between instances. */
export function createMemoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: Date }>();

  function prune(time: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt.getTime() <= time) windows.delete(key);
    }
  }

  return {
    async hit(key, windowMs, now) {
      prune(now.getTime());
      const window = windows.get(key);
      if (window) {
        window.count += 1;
      } else {
        windows.set(key, { count: 1, resetAt: new Date(now.getTime() + windowMs) });
      }
    },
    async read(key) {
      const window = windows.get(key);
      return window && { ...window };
    },
    async delete(key) {
      windows.delete(key);
    },
  };
}

/**
 * Windows in the `rate_limits` table. `getDb` is called on first use, so importing this module
 * doesn't open the app's pool (or validate its env).
 */
export function createPgRateLimitStore(getDb: () => Promise<Db>): RateLimitStore {
  return {
    async hit(key, windowMs, now) {
      await hitRateLimit(await getDb(), key, windowMs, now);
    },
    async read(key) {
      return readRateLimit(await getDb(), key);
    },
    async delete(key) {
      await deleteRateLimit(await getDb(), key);
    },
  };
}

let appStore: RateLimitStore = createPgRateLimitStore(() =>
  import("./db").then((module) => module.db),
);

/** The app limiters' store: the shared `rate_limits` table on the app pool. */
export const appRateLimitStore: RateLimitStore = {
  hit: (key, windowMs, now) => appStore.hit(key, windowMs, now),
  read: (key) => appStore.read(key),
  delete: (key) => appStore.delete(key),
};

/**
 * Tests only: puts the app limiters on another store. `vitest.setup.ts` gives every test file a
 * fresh in-memory one, so tests never write counters to the development database.
 */
export function setAppRateLimitStore(store: RateLimitStore): void {
  appStore = store;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

interface LoginLimiters {
  /** Failed logins per normalised email. */
  byEmail: RateLimiter;
  /** Failed logins per client IP. */
  byIp: RateLimiter;
}

export const loginLimiters: LoginLimiters = {
  byEmail: createRateLimiter({
    name: "login-email",
    limit: 5,
    windowMs: FIFTEEN_MINUTES_MS,
    store: appRateLimitStore,
  }),
  byIp: createRateLimiter({
    name: "login-ip",
    limit: 20,
    windowMs: FIFTEEN_MINUTES_MS,
    store: appRateLimitStore,
  }),
};

/**
 * Wrong current passwords on the profile page (#54), per user id: the email and password forms
 * share it, so a stolen session can't guess the password through either.
 */
export const profilePasswordLimiter: RateLimiter = createRateLimiter({
  name: "profile-password",
  limit: 5,
  windowMs: FIFTEEN_MINUTES_MS,
  store: appRateLimitStore,
});

/**
 * Promo codes the cart refused (#59), per client IP (or visitor id), so codes can't be guessed by
 * trying them one after another.
 */
export const promoCodeLimiter: RateLimiter = createRateLimiter({
  name: "promo-code",
  limit: 10,
  windowMs: FIFTEEN_MINUTES_MS,
  store: appRateLimitStore,
});

/**
 * Gift card codes checkout refused (#125), per client IP (or visitor id), so codes can't be
 * guessed by trying them one after another.
 */
export const giftCardCodeLimiter: RateLimiter = createRateLimiter({
  name: "gift-card-code",
  limit: 10,
  windowMs: FIFTEEN_MINUTES_MS,
  store: appRateLimitStore,
});

// The per-IP limits' key: `X-Forwarded-For` as far as `TRUSTED_PROXY_HOPS` allows (#143).
export { getClientIp } from "./client-ip";
