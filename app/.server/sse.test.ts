import { afterEach, describe, expect, it, vi } from "vitest";
import { eventStreamResponse, sseFrame } from "./sse";

async function text(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sseFrame", () => {
  it("names the event by its type and sends it whole as JSON", () => {
    expect(sseFrame({ type: "intro", text: "Ось\nсвіжі." } as { type: string })).toBe(
      'event: intro\ndata: {"type":"intro","text":"Ось\\nсвіжі."}\n\n',
    );
  });
});

describe("eventStreamResponse (#164)", () => {
  it("streams every event as a frame, with event-stream headers", async () => {
    async function* events() {
      yield { type: "step" };
      yield { type: "done" };
    }
    const response = eventStreamResponse(events(), { status: 429 });

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(await text(response)).toBe(
      'event: step\ndata: {"type":"step"}\n\nevent: done\ndata: {"type":"done"}\n\n',
    );
  });

  it("sends a ping comment while an event takes long", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    async function* events() {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield { type: "done" };
    }
    const response = eventStreamResponse(events(), { pingMs: 1000 });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    await vi.advanceTimersByTimeAsync(1000);
    const ping = await reader?.read();
    expect(decoder.decode(ping?.value)).toBe(": ping\n\n");

    release();
    const done = await reader?.read();
    expect(decoder.decode(done?.value)).toContain("event: done");
  });

  it("calls onCancel and closes the events when the client goes away", async () => {
    const onCancel = vi.fn();
    const closed = vi.fn();
    async function* events() {
      try {
        yield { type: "step" };
        yield { type: "step" };
      } finally {
        closed();
      }
    }
    const response = eventStreamResponse(events(), { onCancel });
    const reader = response.body?.getReader();
    await reader?.read();

    await reader?.cancel();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
