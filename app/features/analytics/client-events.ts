// Client-only analytics events (#18, #129): queued in the browser and posted to `/api/events` with
// `navigator.sendBeacon`, which survives the page being closed. Page views of client-side
// navigations, the product lists' impressions and clicks and the product page's dwell time go
// this way; everything else is recorded on the server.
import { type ClientEvent, MAX_CLIENT_EVENTS } from "~/lib/analytics";

export const CLIENT_EVENTS_ENDPOINT = "/api/events";

/** How long a batched event (an impression) may wait before its batch is sent. */
export const BATCH_DELAY_MS = 5000;

/** Sends one JSON batch; must not throw. */
export type SendBatch = (body: string) => void;

/** `setTimeout` / `clearTimeout`, replaceable in tests. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** The browser's (and Node's) timers. */
export const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface EventQueue {
  /** Queues an event for the next `flush`. */
  push(event: ClientEvent): void;
  /**
   * Queues an event to go out with others: within `BATCH_DELAY_MS`, or at once when a full batch
   * (`MAX_CLIENT_EVENTS`) is waiting.
   */
  batch(event: ClientEvent): void;
  /** Sends everything queued, in batches of at most `MAX_CLIENT_EVENTS`. */
  flush(): void;
}

export function createEventQueue(
  send: SendBatch,
  { timers = browserTimers, delayMs = BATCH_DELAY_MS }: { timers?: Timers; delayMs?: number } = {},
): EventQueue {
  const queue: ClientEvent[] = [];
  let timer: unknown = null;

  function flush() {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_CLIENT_EVENTS);
      try {
        send(JSON.stringify({ events }));
      } catch {
        // Analytics never breaks the page.
      }
    }
  }

  return {
    push(event) {
      queue.push(event);
    },
    batch(event) {
      queue.push(event);
      if (queue.length >= MAX_CLIENT_EVENTS) {
        flush();
      } else if (timer === null) {
        timer = timers.set(flush, delayMs);
      }
    },
    flush,
  };
}

/** Posts a batch with `sendBeacon`, or a `keepalive` fetch where that's missing or refused. */
export function sendBeaconBatch(body: string): void {
  if (typeof navigator !== "undefined" && navigator.sendBeacon?.(CLIENT_EVENTS_ENDPOINT, body)) {
    return;
  }
  fetch(CLIENT_EVENTS_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
}

/** The page's one queue, shared by every tracker so they send together. */
export const clientEvents: EventQueue = createEventQueue(sendBeaconBatch);
