import {
  type EventInput,
  findEventProductIds,
  getVisitor,
  isTrackingAllowed,
  readVisitor,
  trackEvents,
} from "~/.server/analytics";
import { eventsLimiter, MAX_EVENTS_BODY_BYTES, readLimitedBody } from "~/.server/client-events";
import { getClientIp } from "~/.server/rate-limit";
import type { ClientEvent } from "~/lib/analytics";
import { clientEventBatchSchema } from "~/lib/analytics.schema";
import type { Route } from "./+types/api.events";

function status(code: number, headers?: HeadersInit): Response {
  return new Response(null, { status: code, headers });
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

/**
 * The batch as events to record. A product event gets its product's `products.id`, and one about
 * a product that doesn't exist is dropped: the browser's word is only trusted as far as its shape.
 */
async function toEventInputs(events: ClientEvent[], base: string): Promise<EventInput[]> {
  const productIds = await findEventProductIds(
    events.flatMap((event) =>
      event.type === "page_view" ? [] : [event.properties.product_public_id],
    ),
  );
  return events.flatMap((event): EventInput[] => {
    const referrer = event.referrer ? { referrer: new URL(event.referrer, base).href } : {};
    if (event.type === "page_view") {
      return [{ type: event.type, properties: { path: event.path }, ...referrer }];
    }
    const productId = productIds.get(event.properties.product_public_id);
    if (productId === undefined) {
      return [];
    }
    return [{ type: event.type, productId, properties: event.properties, ...referrer }];
  });
}

// POST only: batches of client-only events, sent by the client tracker with `navigator.sendBeacon`
// (#18): page views of client-side navigations, and the product lists' impressions and clicks and
// the product page's dwell time (#129). Every other event is recorded on the server where it
// happens, so the browser can't send them. Answers 204 even when recording fails: the browser
// ignores the response and tracking must never cause errors.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return status(405, { Allow: "POST" });
  }
  const text = await readLimitedBody(request, MAX_EVENTS_BODY_BYTES).catch(() => null);
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
    if (await eventsLimiter.isBlocked(key)) {
      return status(429);
    }
    await eventsLimiter.hit(key);
    if (!(await isTrackingAllowed(request))) {
      return status(204);
    }

    // The session's landing page (when this starts one) is the page, not this endpoint.
    const [first] = events;
    const page = first
      ? new Request(new URL(first.path, request.url), { headers: request.headers })
      : request;
    const visitor = await getVisitor(page);
    const inputs = await toEventInputs(events, request.url);
    if (inputs.length > 0) {
      await trackEvents(visitor, page, inputs);
    }
    return status(204, visitor.headers);
  } catch (error: unknown) {
    console.error("Recording client events failed", error);
    return status(204);
  }
}
