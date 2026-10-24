import {
  type EventInput,
  getVisitor,
  isTrackingAllowed,
  readVisitor,
  trackEvents,
} from "~/.server/analytics";
import { createRateLimiter, getClientIp, type RateLimiter } from "~/.server/rate-limit";
import { type ClientEvent, clientEventBatchSchema } from "~/lib/analytics";
import type { Route } from "./+types/api.events";

/** Largest request body accepted, in bytes. */
export const MAX_BODY_BYTES = 16 * 1024;

// Batches per visitor (IP, else visitor id) per minute; a normal visitor sends one per navigation.
// Kept on `globalThis` so dev-server reloads don't reset it, like the contact form's limiter.
const globalForLimiter = globalThis as { __jassminEventsLimiter?: RateLimiter };
globalForLimiter.__jassminEventsLimiter ??= createRateLimiter({ limit: 60, windowMs: 60_000 });
const limiter = globalForLimiter.__jassminEventsLimiter;

function status(code: number, headers?: HeadersInit): Response {
  return new Response(null, { status: code, headers });
}

/** The body as text, or `null` when it's larger than `maxBytes`. Stops reading at the limit. */
async function readLimited(request: Request, maxBytes: number): Promise<string | null> {
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

function parseBatch(text: string): ClientEvent[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = clientEventBatchSchema.safeParse(json);
  return parsed.success ? parsed.data.events : null;
}

// POST only: batches of client-only events (page views of client-side navigations), sent by the
// client tracker with `navigator.sendBeacon` (#18). Every other event is recorded on the server
// where it happens, so the browser can't send them. Answers 204 even when recording fails: the
// browser ignores the response and tracking must never cause errors.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return status(405, { Allow: "POST" });
  }
  const text = await readLimited(request, MAX_BODY_BYTES).catch(() => null);
  if (text === null) {
    return status(413);
  }
  // sendBeacon posts a string as `text/plain`, so the content type isn't checked.
  const events = parseBatch(text);
  if (!events) {
    return status(400);
  }

  try {
    const key = getClientIp(request) ?? (await readVisitor(request)).anonymousId ?? "anonymous";
    if (limiter.isBlocked(key)) {
      return status(429);
    }
    limiter.hit(key);
    if (!(await isTrackingAllowed(request))) {
      return status(204);
    }

    // The session's landing page (when this starts one) is the page, not this endpoint.
    const [first] = events;
    const page = first
      ? new Request(new URL(first.path, request.url), { headers: request.headers })
      : request;
    const visitor = await getVisitor(page);
    const inputs = events.map(
      (event): EventInput => ({
        type: event.type,
        properties: { path: event.path },
        ...(event.referrer && { referrer: new URL(event.referrer, request.url).href }),
      }),
    );
    await trackEvents(visitor, page, inputs);
    return status(204, visitor.headers);
  } catch (error: unknown) {
    console.error("Recording client events failed", error);
    return status(204);
  }
}
