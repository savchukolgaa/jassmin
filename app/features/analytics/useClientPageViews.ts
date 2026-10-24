import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { createEventQueue, sendBeaconBatch } from "./client-events";

const queue = createEventQueue(sendBeaconBatch);

/**
 * Records a `page_view` for each client-side navigation, once the visitor accepted analytics
 * cookies (#18). The first page isn't sent: the server counted that full page load (or, right
 * after accepting, the consent route did).
 */
export function useClientPageViews(enabled: boolean): void {
  const { pathname, search } = useLocation();
  const path = pathname + search;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const referrer = previous.current;
    previous.current = path;
    if (!enabled || referrer === null || referrer === path) {
      return;
    }
    queue.push({ type: "page_view", path, referrer });
    queue.flush();
  }, [enabled, path]);

  // Anything still queued goes out when the page is hidden or closed.
  useEffect(() => {
    const flush = () => queue.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
}
