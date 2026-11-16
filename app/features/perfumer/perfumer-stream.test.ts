import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerfumerEvent } from "~/lib/perfumer";
import { StreamFailedError, streamPerfumerReply } from "./perfumer-stream";

const step: PerfumerEvent = {
  type: "step",
  step: { tool: "search", families: ["водяні"], found: 2 },
};

const frame = (event: { type: string; [field: string]: unknown }) =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** An event-stream response with this body, in these pieces. */
function stream(pieces: readonly string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[index++];
        if (piece === undefined) controller.close();
        else controller.enqueue(encoder.encode(piece));
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" }, ...init },
  );
}

function run(
  response: Response | (() => Promise<Response>),
  signal = new AbortController().signal,
) {
  const fetchFn = vi.fn<typeof fetch>(
    typeof response === "function" ? response : async () => response,
  );
  vi.stubGlobal("fetch", fetchFn);
  const events: PerfumerEvent[] = [];
  const result = streamPerfumerReply({
    url: "/parfumer/stream",
    payload: '{"messages":[]}',
    signal,
    onEvent: (event) => events.push(event),
  });
  return { result, events, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamPerfumerReply (#164)", () => {
  it("posts the payload and hands over each event until done", async () => {
    const pieces = [frame(step), ": ping\n\n", frame({ type: "intro", text: "Ось." })];
    const { result, events, fetchFn } = run(
      stream([...(pieces.join("").match(/.{1,7}/gs) ?? []), frame({ type: "done" })]),
    );

    await expect(result).resolves.toEqual({ type: "done" });
    expect(events).toEqual([step, { type: "intro", text: "Ось." }]);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("/parfumer/stream");
    expect(init?.method).toBe("POST");
    expect(init?.body instanceof FormData && init.body.get("payload")).toBe('{"messages":[]}');
  });

  it("resolves with an error event the server sent, such as a 429", async () => {
    const { result } = run(
      stream([frame({ type: "error", error: "rateLimited" })], { status: 429 }),
    );
    await expect(result).resolves.toEqual({ type: "error", error: "rateLimited" });
  });

  it.each([
    ["a network failure", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 404 page", async () => new Response("<html>", { status: 404 })],
    [
      "a JSON answer",
      async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ],
    ["a stream that ends early", async () => stream([frame(step)])],
    ["an event that isn't JSON", async () => stream(["event: step\ndata: {nope\n\n"])],
    ["an unknown event", async () => stream([frame({ type: "surprise" })])],
  ])("fails over %s", async (_name, response) => {
    const { result } = run(response);
    await expect(result).rejects.toBeInstanceOf(StreamFailedError);
  });

  it("rethrows the abort when the customer cancels, not a stream failure", async () => {
    const controller = new AbortController();
    const { result } = run(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }, controller.signal);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
