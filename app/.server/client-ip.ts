// The client IP for the per-IP rate limits (#143). `X-Forwarded-For` is a list each proxy appends
// to ("client, proxy1, proxy2"), and the client can send any list it likes, so only the entries
// added by the `TRUSTED_PROXY_HOPS` proxies in front of the app are trusted: the client is the
// entry that many places from the right. See docs/security.md.
import { isIP } from "node:net";
import { getEnv } from "./env";

/**
 * The client IP from an `X-Forwarded-For` value behind `hops` trusted proxies, or `undefined`
 * when there are none (`hops` 0), the header has fewer entries than that, or the entry isn't an IP.
 */
export function clientIpFromHeader(header: string | null, hops: number): string | undefined {
  if (hops < 1 || !header) return undefined;
  const entries = header.split(",").map((entry) => entry.trim());
  const ip = entries[entries.length - hops];
  return ip && isIP(ip) !== 0 ? ip : undefined;
}

/** The client IP of `request`, or `undefined` when it isn't known (see `clientIpFromHeader`). */
export function getClientIp(
  request: Request,
  hops: number = getEnv().TRUSTED_PROXY_HOPS,
): string | undefined {
  return clientIpFromHeader(request.headers.get("X-Forwarded-For"), hops);
}

let warned = false;

/**
 * Warns once when production runs without trusted proxy hops: behind a hosting proxy the per-IP
 * limits then fall back to visitor ids or one shared key.
 */
export function warnIfNoTrustedProxy(
  env: { NODE_ENV: string; TRUSTED_PROXY_HOPS: number } = getEnv(),
): void {
  if (warned || env.NODE_ENV !== "production" || env.TRUSTED_PROXY_HOPS > 0) return;
  warned = true;
  console.warn(
    "TRUSTED_PROXY_HOPS is 0: X-Forwarded-For is ignored and per-IP rate limits can't tell " +
      "clients apart. Set it to the number of proxies in front of the app (see docs/security.md).",
  );
}
