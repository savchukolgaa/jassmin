import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_IMPRESSION_VISIBLE_MS } from "~/lib/analytics";
import { createImpressionTracker } from "./impressions";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("impression tracker (#129)", () => {
  it("counts a card that stays at least half visible for a second", () => {
    const tracker = createImpressionTracker();
    const seen = vi.fn();

    tracker.enter("a", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS - 1);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("doesn't count a card scrolled past within the second", () => {
    const tracker = createImpressionTracker();
    const seen = vi.fn();

    tracker.enter("a", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS / 2);
    tracker.leave("a");
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 5);
    expect(seen).not.toHaveBeenCalled();

    // Coming back starts the second again, without the time it was seen before.
    tracker.enter("a", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS - 1);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("counts each card once per list render", () => {
    const tracker = createImpressionTracker();
    const seen = vi.fn();

    for (let round = 0; round < 3; round++) {
      tracker.enter("a", seen);
      vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS);
      tracker.leave("a");
    }
    tracker.enter("b", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS);

    expect(seen).toHaveBeenCalledTimes(2);
    // A new list render is a new tracker, so the card counts again.
    const next = createImpressionTracker();
    next.enter("a", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("doesn't count while the page is hidden, and starts afresh when it's back", () => {
    const tracker = createImpressionTracker();
    const seen = vi.fn();

    tracker.enter("a", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS - 100);
    tracker.pause();
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 10);
    tracker.enter("b", seen);
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 10);
    expect(seen).not.toHaveBeenCalled();

    tracker.resume();
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS - 1);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("stops every timer when disposed", () => {
    const tracker = createImpressionTracker();
    const seen = vi.fn();

    tracker.enter("a", seen);
    tracker.dispose();
    vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 2);
    expect(seen).not.toHaveBeenCalled();
  });
});
