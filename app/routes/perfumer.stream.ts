import { data } from "react-router";
import { isPerfumerEnabled } from "~/.server/ai/config";
import { ensureVisitor, trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getClientIp } from "~/.server/rate-limit";
import { openPerfumerStream } from "~/.server/services/perfumer-chat";
import { eventStreamResponse } from "~/.server/sse";
import type { PerfumerMessageProperties } from "~/lib/analytics";
import type { PerfumerErrorKey, PerfumerEvent } from "~/lib/perfumer";
import { parsePerfumerRequest } from "~/lib/perfumer.schema";
import type { Route } from "./+types/perfumer.stream";

// The AI perfumer chat's streamed answer (#164): `POST /parfumer/stream`, `/en/perfumer/stream`.
// The same request, validation and rate limit as the chat's action (`perfumer.tsx`), answered as
// server-sent events (`PerfumerEvent`, see `docs/ai-perfumer.md`). The browser reads it with
// `fetch` because `useFetcher` can't stream; the action stays the fallback. A 404 while the
// engine is off.

/** A refusal before anything streams gets the action's status; one `error` event says why. */
const ERROR_STATUS: Record<PerfumerErrorKey, number> = {
  tooLong: 400,
  rateLimited: 429,
  unavailable: 503,
  timeout: 504,
};

async function* only(event: PerfumerEvent): AsyncGenerator<PerfumerEvent> {
  yield event;
}

function refusal(error: PerfumerErrorKey): Response {
  return eventStreamResponse(only({ type: "error", error }), { status: ERROR_STATUS[error] });
}

export async function action(args: Route.ActionArgs) {
  if (!isPerfumerEnabled()) {
    throw data(null, { status: 404 });
  }
  const { request } = args;
  const parsed = parsePerfumerRequest(await request.formData());
  if (!parsed.ok) {
    return refusal(parsed.error);
  }
  // The visitor's id works without analytics consent, like the guest cart's (#18).
  const [locale, visitor] = await Promise.all([getLocale(request), ensureVisitor(args)]);
  // The model call stops when the customer closes the page or cancels: the request is aborted, or
  // the response body cancelled, whichever the server notices first.
  const stop = new AbortController();
  // One `perfumer_message` per message (#166), with analytics consent; never any text. A streamed
  // one is recorded when its stream ends, however it ends.
  const record = (event: PerfumerMessageProperties) =>
    void trackEvent(args, "perfumer_message", { properties: event });
  const result = await openPerfumerStream({
    locale,
    messages: parsed.messages,
    turn: parsed.turn,
    entry: parsed.entry,
    ipKey: getClientIp(request),
    sessionKey: visitor.anonymousId,
    signal: AbortSignal.any([request.signal, stop.signal]),
    onEvent: record,
  });
  if (!result.ok) {
    record(result.event);
    return refusal(result.error);
  }
  return eventStreamResponse(result.events, { onCancel: () => stop.abort() });
}
