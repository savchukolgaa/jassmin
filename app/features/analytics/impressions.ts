// When a product card counts as seen (#129): at least half of it stays in view for
// `MIN_IMPRESSION_VISIBLE_MS` without a break, while the page is visible. Each card counts once
// per list render. Pure (no DOM), so the rule is tested without a browser; `ProductList.tsx` feeds
// it from an `IntersectionObserver`.
import { MIN_IMPRESSION_VISIBLE_MS } from "~/lib/analytics";
import { browserTimers, type Timers } from "./client-events";

export interface ImpressionTracker {
  /** The card `key` became at least half visible; `onImpression` runs if it stays so. */
  enter(key: string, onImpression: () => void): void;
  /** The card `key` scrolled out of view (or unmounted) before counting. */
  leave(key: string): void;
  /** The page was hidden: no card counts until `resume`. */
  pause(): void;
  /** The page is visible again: the cards still in view start counting afresh. */
  resume(): void;
  /** Stops every timer; the tracker isn't used again. */
  dispose(): void;
}

export function createImpressionTracker({
  timers = browserTimers,
  minVisibleMs = MIN_IMPRESSION_VISIBLE_MS,
}: {
  timers?: Timers;
  minVisibleMs?: number;
} = {}): ImpressionTracker {
  const seen = new Set<string>();
  const inView = new Map<string, () => void>();
  const running = new Map<string, unknown>();
  let paused = false;

  function stop(key: string) {
    const handle = running.get(key);
    if (handle !== undefined) {
      timers.clear(handle);
      running.delete(key);
    }
  }

  function start(key: string, onImpression: () => void) {
    stop(key);
    running.set(
      key,
      timers.set(() => {
        running.delete(key);
        inView.delete(key);
        if (!seen.has(key)) {
          seen.add(key);
          onImpression();
        }
      }, minVisibleMs),
    );
  }

  return {
    enter(key, onImpression) {
      if (seen.has(key)) {
        return;
      }
      inView.set(key, onImpression);
      if (!paused && !running.has(key)) {
        start(key, onImpression);
      }
    },
    leave(key) {
      inView.delete(key);
      stop(key);
    },
    pause() {
      paused = true;
      for (const key of [...running.keys()]) {
        stop(key);
      }
    },
    resume() {
      paused = false;
      for (const [key, onImpression] of inView) {
        start(key, onImpression);
      }
    },
    dispose() {
      paused = true;
      for (const key of [...running.keys()]) {
        stop(key);
      }
      inView.clear();
    },
  };
}
