import { describe, expect, it, vi } from "vitest";
import { MAX_CLIENT_EVENTS } from "~/lib/analytics";
import { BATCH_DELAY_MS, createEventQueue, type Timers } from "./client-events";

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

  describe("batched events (#129)", () => {
    /** Timers the test fires by hand. */
    function manualTimers() {
      const pending = new Map<number, () => void>();
      let next = 0;
      const timers: Timers = {
        set(callback, ms) {
          expect(ms).toBe(BATCH_DELAY_MS);
          pending.set(++next, callback);
          return next;
        },
        clear(handle) {
          pending.delete(handle as number);
        },
      };
      const fire = () => {
        for (const [handle, callback] of [...pending]) {
          pending.delete(handle);
          callback();
        }
      };
      return { timers, fire, pending };
    }

    it("sends batched events together once the delay is over", () => {
      const send = vi.fn();
      const { timers, fire, pending } = manualTimers();
      const queue = createEventQueue(send, { timers });

      queue.batch(view(1));
      queue.batch(view(2));
      expect(send).not.toHaveBeenCalled();
      expect(pending.size).toBe(1);

      fire();
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(send.mock.calls[0]?.[0] as string).events).toHaveLength(2);
    });

    it("sends a full batch at once", () => {
      const send = vi.fn();
      const { timers, pending } = manualTimers();
      const queue = createEventQueue(send, { timers });

      for (let n = 0; n < MAX_CLIENT_EVENTS; n++) {
        queue.batch(view(n));
      }

      expect(send).toHaveBeenCalledTimes(1);
      expect(pending.size).toBe(0);
    });

    it("cancels the timer when flushed early (the page is hidden)", () => {
      const send = vi.fn();
      const { timers, fire, pending } = manualTimers();
      const queue = createEventQueue(send, { timers });

      queue.batch(view(1));
      queue.flush();
      expect(pending.size).toBe(0);
      fire();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
