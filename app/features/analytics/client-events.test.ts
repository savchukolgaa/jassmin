import { describe, expect, it, vi } from "vitest";
import { MAX_CLIENT_EVENTS } from "~/lib/analytics";
import { createEventQueue } from "./client-events";

const view = (n: number) => ({ type: "page_view" as const, path: `/p/${n}`, referrer: "/" });

describe("client event queue", () => {
  it("sends nothing until flushed, then everything once", () => {
    const send = vi.fn();
    const queue = createEventQueue(send);

    queue.push(view(1));
    queue.push(view(2));
    expect(send).not.toHaveBeenCalled();

    queue.flush();
    queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({ events: [view(1), view(2)] });
  });

  it("splits a long queue into batches the endpoint accepts", () => {
    const send = vi.fn();
    const queue = createEventQueue(send);

    for (let n = 0; n < MAX_CLIENT_EVENTS + 5; n++) {
      queue.push(view(n));
    }
    queue.flush();

    const sizes = send.mock.calls.map(([body]) => JSON.parse(body as string).events.length);
    expect(sizes).toEqual([MAX_CLIENT_EVENTS, 5]);
  });

  it("never throws when sending fails", () => {
    const queue = createEventQueue(() => {
      throw new Error("offline");
    });
    queue.push(view(1));

    expect(() => queue.flush()).not.toThrow();
  });
});
