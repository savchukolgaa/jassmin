// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClientEvent, MAX_DWELL_MS } from "~/lib/analytics";
import { clientEvents } from "./client-events";
import { TrackingProvider } from "./tracking";
import { dwellMs, scrollDepthPct, useProductDwell } from "./useProductDwell";

const PRODUCT = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  variants: [
    { id: "01a1652b-6e25-7d00-8000-000000000005", volumeMl: 5, price: "290.00", inStock: true },
  ],
};
const OTHER = { ...PRODUCT, id: "01a1652b-6e25-7c03-ae47-000000000002" };

let clock = 0;
let pushed: ClientEvent[];
let visibility: DocumentVisibilityState;

function Page({ product }: { product: typeof PRODUCT }) {
  useProductDwell(product, { now: () => clock });
  return null;
}

function renderPage(product = PRODUCT, enabled = true) {
  const page = (shown: typeof PRODUCT) =>
    createElement(TrackingProvider, { enabled }, createElement(Page, { product: shown }));
  const view = render(page(product));
  return { ...view, show: (next: typeof PRODUCT) => view.rerender(page(next)) };
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  clock = 1000;
  pushed = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.spyOn(clientEvents, "push").mockImplementation((event) => pushed.push(event));
  vi.spyOn(clientEvents, "flush").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProductDwell (#129)", () => {
  it("sends the time on the page and the size shown when the visitor navigates on", () => {
    const { unmount } = renderPage();
    clock += 42_000;
    unmount();

    expect(pushed).toEqual([
      {
        type: "product_dwell",
        path: "/",
        properties: {
          product_public_id: PRODUCT.id,
          variant_id: PRODUCT.variants[0]?.id,
          volume_ml: 5,
          price: "290.00",
          in_stock: true,
          dwell_ms: 42_000,
          max_scroll_pct: expect.any(Number),
        },
      },
    ]);
  });

  it("sends once, on the first of the page being hidden or closed", () => {
    const { unmount } = renderPage();
    clock += 5000;
    setVisibility("hidden");
    clock += 60_000;
    setVisibility("visible");
    window.dispatchEvent(new Event("pagehide"));
    unmount();

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ properties: { dwell_ms: 5000 } });
  });

  it("starts the clock in a background tab only once the page is shown", () => {
    visibility = "hidden";
    const { unmount } = renderPage();
    clock += 600_000;
    setVisibility("visible");
    clock += 3000;
    unmount();

    expect(pushed).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ dwell_ms: 3000 }) }),
    ]);
  });

  it("sends nothing for a page never shown", () => {
    visibility = "hidden";
    const { unmount } = renderPage();
    clock += 10_000;
    unmount();

    expect(pushed).toEqual([]);
  });

  it("caps the time at 30 minutes", () => {
    const { unmount } = renderPage();
    clock += MAX_DWELL_MS * 3;
    unmount();

    expect(pushed[0]).toMatchObject({ properties: { dwell_ms: MAX_DWELL_MS } });
  });

  it("sends the old product's dwell when the page moves on to another product", () => {
    const { show, unmount } = renderPage();
    clock += 2000;
    show(OTHER);
    clock += 7000;
    unmount();

    expect(pushed.map((event) => event.type === "product_dwell" && event.properties)).toEqual([
      expect.objectContaining({ product_public_id: PRODUCT.id, dwell_ms: 2000 }),
      expect.objectContaining({ product_public_id: OTHER.id, dwell_ms: 7000 }),
    ]);
  });

  it("sends nothing without analytics consent", () => {
    const { unmount } = renderPage(PRODUCT, false);
    clock += 5000;
    setVisibility("hidden");
    unmount();

    expect(pushed).toEqual([]);
  });
});

describe("dwell helpers", () => {
  it("rounds and caps the time", () => {
    expect(dwellMs(100, 1100.4)).toBe(1000);
    expect(dwellMs(100, 50)).toBe(0);
    expect(dwellMs(0, MAX_DWELL_MS + 1)).toBe(MAX_DWELL_MS);
  });

  it("measures how much of the page has been on screen", () => {
    expect(scrollDepthPct(0, 800, 3200)).toBe(25);
    expect(scrollDepthPct(2400, 800, 3200)).toBe(100);
    expect(scrollDepthPct(5000, 800, 3200)).toBe(100);
    expect(scrollDepthPct(0, 800, 0)).toBe(100);
  });
});
