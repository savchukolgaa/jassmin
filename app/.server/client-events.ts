// Limits for `routes/api.events.ts`, the client tracker's endpoint (#18). Kept out of the route
// module because its top-level state (the rate limiter) must stay on the server.
import { createRateLimiter, type RateLimiter } from "./rate-limit";

/** Largest request body accepted, in bytes. */
export const MAX_EVENTS_BODY_BYTES = 16 * 1024;

// Batches per visitor (IP, else visitor id) per minute; a normal visitor sends one per navigation.
// Kept on `globalThis` so dev-server reloads don't reset it, like the contact form's limiter.
const globalForLimiter = globalThis as { __jassminEventsLimiter?: RateLimiter };
globalForLimiter.__jassminEventsLimiter ??= createRateLimiter({ limit: 60, windowMs: 60_000 });
export const eventsLimiter: RateLimiter = globalForLimiter.__jassminEventsLimiter;

/** The body as text, or `null` when it's larger than `maxBytes`. Stops reading at the limit. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
    return null;
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
