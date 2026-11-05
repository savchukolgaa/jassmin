// In-memory fixed-window rate limiting. Counters live in this Node process only: they reset on
// restart and aren't shared between instances, which is enough for a single-instance shop.

export interface RateLimiterOptions {
  /** Hits allowed per key within one window. */
  limit: number;
  windowMs: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface RateLimiter {
  /** Whether the key has used up its hits in the current window. */
  isBlocked(key: string): boolean;
  /** Counts one hit (e.g. a failed login) for the key. */
  hit(key: string): void;
  /** Forgets the key's hits (e.g. after a successful login). */
  reset(key: string): void;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, Window>();

  function prune(time: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= time) windows.delete(key);
    }
  }

  return {
    isBlocked(key) {
      const window = windows.get(key);
      return window !== undefined && window.resetAt > now() && window.count >= limit;
    },
    hit(key) {
      const time = now();
      prune(time);
      const window = windows.get(key);
      if (window) {
        window.count += 1;
      } else {
        windows.set(key, { count: 1, resetAt: time + windowMs });
      }
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface LoginLimiters {
  /** Failed logins per normalised email. */
  byEmail: RateLimiter;
  /** Failed logins per client IP. */
  byIp: RateLimiter;
}

// Keep the counters across Vite HMR reloads in development, like the `db` pool.
const globalForLimiters = globalThis as typeof globalThis & {
  __jassminLoginLimiters?: LoginLimiters;
};

globalForLimiters.__jassminLoginLimiters ??= {
  byEmail: createRateLimiter({ limit: 5, windowMs: LOGIN_WINDOW_MS }),
  byIp: createRateLimiter({ limit: 20, windowMs: LOGIN_WINDOW_MS }),
};

export const loginLimiters: LoginLimiters = globalForLimiters.__jassminLoginLimiters;

const globalForProfileLimiter = globalThis as typeof globalThis & {
  __jassminProfilePasswordLimiter?: RateLimiter;
};

globalForProfileLimiter.__jassminProfilePasswordLimiter ??= createRateLimiter({
  limit: 5,
  windowMs: LOGIN_WINDOW_MS,
});

/**
 * Wrong current passwords on the profile page (#54), per user id: the email and password forms
 * share it, so a stolen session can't guess the password through either.
 */
export const profilePasswordLimiter: RateLimiter =
  globalForProfileLimiter.__jassminProfilePasswordLimiter;

const globalForPromoLimiter = globalThis as typeof globalThis & {
  __jassminPromoCodeLimiter?: RateLimiter;
};

globalForPromoLimiter.__jassminPromoCodeLimiter ??= createRateLimiter({
  limit: 10,
  windowMs: LOGIN_WINDOW_MS,
});

/**
 * Promo codes the cart refused (#59), per client IP (or visitor id), so codes can't be guessed by
 * trying them one after another.
 */
export const promoCodeLimiter: RateLimiter = globalForPromoLimiter.__jassminPromoCodeLimiter;

const globalForGiftCardLimiter = globalThis as typeof globalThis & {
  __jassminGiftCardCodeLimiter?: RateLimiter;
};

globalForGiftCardLimiter.__jassminGiftCardCodeLimiter ??= createRateLimiter({
  limit: 10,
  windowMs: LOGIN_WINDOW_MS,
});

/**
 * Gift card codes checkout refused (#125), per client IP (or visitor id), so codes can't be
 * guessed by trying them one after another.
 */
export const giftCardCodeLimiter: RateLimiter =
  globalForGiftCardLimiter.__jassminGiftCardCodeLimiter;

// The per-IP limits' key: `X-Forwarded-For` as far as `TRUSTED_PROXY_HOPS` allows (#143).
export { getClientIp } from "./client-ip";
