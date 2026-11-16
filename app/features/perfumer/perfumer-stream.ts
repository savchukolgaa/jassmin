import { isPerfumerEvent, type PerfumerEvent } from "~/lib/perfumer";
import { createSseParser } from "./sse";

// The chat's streamed answer (#164): posts the conversation to `/parfumer/stream` and hands each
// event over as it arrives. A narrow exception to "no client fetching" (AGENTS.md): `useFetcher`
// can't stream, so this uses `fetch` and the body's reader. Anything that keeps the stream from
// working throws `StreamFailedError`, and the chat falls back to its action.

/** The stream couldn't be used or broke off; the chat falls back to the normal request. */
export class StreamFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StreamFailedError";
  }
}

/** The event a stream ends with: the reply is complete, or the server says why it isn't. */
export type StreamEnd = Extract<PerfumerEvent, { type: "done" | "error" }>;

/** Whether this browser can read a streamed response; otherwise the chat uses the action. */
export function canStream(): boolean {
  return (
    typeof fetch === "function" &&
    typeof ReadableStream === "function" &&
    typeof TextDecoder === "function" &&
    typeof AbortController === "function"
  );
}

export interface StreamOptions {
  url: string;
  /** The chat form's `payload` field: `{ messages }` as JSON. */
  payload: string;
  signal: AbortSignal;
  /** Every event before the last: steps, intro sentences, picks, the question. */
  onEvent: (event: PerfumerEvent) => void;
}

/**
 * Streams one reply. Resolves with its last event (`done`, or an `error` the server sent, e.g.
 * `rateLimited`), rejects with `StreamFailedError` when the stream isn't usable or ends early, and
 * with the abort error when `signal` aborts (the customer cancelled).
 */
export async function streamPerfumerReply({
  url,
  payload,
  signal,
  onEvent,
}: StreamOptions): Promise<StreamEnd> {
  const body = new FormData();
  body.set("payload", payload);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body,
      signal,
      headers: { Accept: "text/event-stream" },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new StreamFailedError("The stream couldn't be opened", { cause: error });
  }

  // A refusal (429, 400) is an event stream too; anything else (a 404, an HTML error page, a
  // proxy's answer) isn't the stream.
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.startsWith("text/event-stream") || !response.body) {
    throw new StreamFailedError(`Not an event stream: ${response.status} ${type}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new StreamFailedError("The stream broke off", { cause: error });
      }
      const messages = chunk.done
        ? [...parser.push(decoder.decode()), ...parser.end()]
        : parser.push(decoder.decode(chunk.value, { stream: true }));
      for (const message of messages) {
        let event: unknown;
        try {
          event = JSON.parse(message.data);
        } catch (error) {
          throw new StreamFailedError("An event isn't JSON", { cause: error });
        }
        if (!isPerfumerEvent(event)) {
          throw new StreamFailedError(`Unexpected event: ${message.event}`);
        }
        if (event.type === "done" || event.type === "error") {
          return event;
        }
        onEvent(event);
      }
      if (chunk.done) {
        throw new StreamFailedError("The stream ended before the reply was complete");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
