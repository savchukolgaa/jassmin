// Client-only analytics events (#18): queued in the browser and posted to `/api/events` with
// `navigator.sendBeacon`, which survives the page being closed. Only page views of client-side
// navigations go this way; everything else is recorded on the server.
import { type ClientEvent, MAX_CLIENT_EVENTS } from "~/lib/analytics";

export const CLIENT_EVENTS_ENDPOINT = "/api/events";

/** Sends one JSON batch; must not throw. */
export type SendBatch = (body: string) => void;

export interface EventQueue {
  push(event: ClientEvent): void;
  /** Sends everything queued, in batches of at most `MAX_CLIENT_EVENTS`. */
  flush(): void;
}

export function createEventQueue(send: SendBatch): EventQueue {
  const queue: ClientEvent[] = [];
  return {
    push(event) {
      queue.push(event);
    },
    flush() {
      while (queue.length > 0) {
        const events = queue.splice(0, MAX_CLIENT_EVENTS);
        try {
          send(JSON.stringify({ events }));
        } catch {
          // Analytics never breaks the page.
        }
      }
    },
  };
}

/** Posts a batch with `sendBeacon`, or a `keepalive` fetch where that's missing or refused. */
export function sendBeaconBatch(body: string): void {
  if (typeof navigator !== "undefined" && navigator.sendBeacon?.(CLIENT_EVENTS_ENDPOINT, body)) {
    return;
  }
  fetch(CLIENT_EVENTS_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
}
