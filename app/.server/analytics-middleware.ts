// The `_shop` layout's middleware (#18): finds or creates the analytics visitor for every public
// page, cart and auth request once tracking is allowed, records `page_view` for full page loads,
// and sends the visitor cookies with the response.
import type { MiddlewareFunction } from "react-router";
import {
  getVisitor,
  isDocumentRequest,
  isTrackingAllowed,
  trackEvent,
  visitorContext,
} from "./analytics";
import { db as defaultDb } from "./db";
import type { Db } from "./db/client";

export function createVisitorMiddleware(db: Db = defaultDb): MiddlewareFunction<Response> {
  return async ({ request, context }, next) => {
    try {
      if (await isTrackingAllowed(request)) {
        context.set(visitorContext, await getVisitor(request, db));
        if (isDocumentRequest(request)) {
          const { pathname, search } = new URL(request.url);
          const properties = { path: pathname + search };
          // Not awaited: the page doesn't wait for analytics. Client navigations are sent by the
          // client tracker instead, since a `.data` request can also be a revalidation.
          void trackEvent({ request, context }, "page_view", { properties }, db);
        }
      }
    } catch (error: unknown) {
      // Analytics must never break the page.
      console.error("Finding the analytics visitor failed", error);
    }

    const response = await next();

    // Also covers a visitor that `ensureVisitor` created during the action (the guest cart).
    const cookies = context.get(visitorContext)?.headers.getSetCookie() ?? [];
    if (cookies.length > 0) {
      for (const cookie of cookies) {
        response.headers.append("Set-Cookie", cookie);
      }
      // A shared cache must never store (and replay) another visitor's ids.
      response.headers.set("Cache-Control", "private, no-store");
    }
    return response;
  };
}

export const visitorMiddleware = createVisitorMiddleware();
