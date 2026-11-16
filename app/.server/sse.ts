// Server-sent events for a resource route (#164): the AI perfumer's streamed answer. Each event is
// one frame, `event: <type>` and its JSON as `data:`; a comment frame every 15 s keeps proxies
// and load balancers from closing a connection that waits on a slow model.

/** How often a `: ping` comment is sent while no event is. */
export const SSE_PING_MS = 15_000;

/** One event's frame: its `type` as the event name, the whole event as JSON data. */
export function sseFrame(event: { type: string }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface EventStreamOptions {
  status?: number;
  /** Called when the client goes away (the body is cancelled), before the events are closed. */
  onCancel?: () => void;
  pingMs?: number;
}

/**
 * A `text/event-stream` response that sends `events` as they come. Cancelling the body (the
 * client disconnected) calls `onCancel` and closes the iterator, so its work stops too.
 */
export function eventStreamResponse(
  events: AsyncIterable<{ type: string }>,
  { status = 200, onCancel, pingMs = SSE_PING_MS }: EventStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let ping: ReturnType<typeof setInterval> | undefined;
  let open = true;

  const finish = () => {
    open = false;
    clearInterval(ping);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      ping = setInterval(() => {
        if (open) controller.enqueue(encoder.encode(": ping\n\n"));
      }, pingMs);
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (!open) return;
        if (next.done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(sseFrame(next.value)));
      } catch (error) {
        if (!open) return;
        finish();
        controller.error(error);
      }
    },
    cancel() {
      finish();
      onCancel?.();
      // Don't wait: a pending `next()` settles once `onCancel` has stopped the work.
      void iterator.return?.()?.catch(() => {});
    },
  });

  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // nginx and similar proxies would otherwise buffer the whole answer.
      "X-Accel-Buffering": "no",
    },
  });
}
