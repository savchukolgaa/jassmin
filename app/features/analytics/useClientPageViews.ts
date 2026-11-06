import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { clientEvents } from "./client-events";
import { useFlushOnHide } from "./tracking";

/**
 * Records a `page_view` for each client-side navigation, once the visitor accepted analytics
 * cookies (#18). The first page isn't sent: the server counted that full page load (or, right
 * after accepting, the consent route did). Also sends whatever else is queued (impressions, #129)
 * when the page is hidden or closed.
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
    clientEvents.push({ type: "page_view", path, referrer });
    clientEvents.flush();
  }, [enabled, path]);

  useFlushOnHide();
}
