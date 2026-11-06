// `product_dwell` (#129): how long a product page was read and how far down. Sent once per product
// page view, on the first of: the page is hidden (tab or app switch), it's closed (`pagehide`), or
// the visitor navigates on (unmount). The clock starts once the page is visible (a page opened in
// a background tab waits), so only visible time counts. Only with analytics consent.
import { useEffect, useRef } from "react";
import { MAX_DWELL_MS, productEventContext } from "~/lib/analytics";
import { clientEvents } from "./client-events";
import { useTrackingAllowed } from "./tracking";

type Product = Parameters<typeof productEventContext>[0];

/** Time on the page in whole milliseconds, at most `MAX_DWELL_MS`. */
export function dwellMs(startedAt: number, now: number): number {
  return Math.min(Math.max(Math.round(now - startedAt), 0), MAX_DWELL_MS);
}

/** How much of the page has been on screen, as a whole percentage (0–100). */
export function scrollDepthPct(
  scrollY: number,
  viewportHeight: number,
  pageHeight: number,
): number {
  if (pageHeight <= 0) {
    return 100;
  }
  return Math.min(100, Math.max(0, Math.round(((scrollY + viewportHeight) / pageHeight) * 100)));
}

function currentScrollDepth(): number {
  return scrollDepthPct(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
}

export interface ProductDwellOptions {
  /** A clock in milliseconds; `performance.now` by default. */
  now?: () => number;
}

export function useProductDwell(product: Product, { now }: ProductDwellOptions = {}): void {
  const enabled = useTrackingAllowed();
  const latest = useRef({ product, now });
  latest.current = { product, now };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new product is a new page view.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    // This view's product and page, fixed now: the cleanup runs after the next product rendered.
    const { product: shown, now: clock = () => performance.now() } = latest.current;
    const path = window.location.pathname + window.location.search;
    const isVisible = () => document.visibilityState !== "hidden";
    let startedAt = isVisible() ? clock() : null;
    let maxScroll = currentScrollDepth();
    let sent = false;

    const send = () => {
      // Never seen (opened and closed in a background tab): nothing to report.
      if (sent || startedAt === null) return;
      sent = true;
      clientEvents.push({
        type: "product_dwell",
        path,
        properties: {
          ...productEventContext(shown),
          dwell_ms: dwellMs(startedAt, clock()),
          max_scroll_pct: maxScroll,
        },
      });
      clientEvents.flush();
    };
    const onScroll = () => {
      maxScroll = Math.max(maxScroll, currentScrollDepth());
    };
    const onVisibility = () => {
      if (!isVisible()) {
        send();
      } else if (startedAt === null) {
        startedAt = clock();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onVisibility);
      send();
    };
  }, [enabled, product.id]);
}
