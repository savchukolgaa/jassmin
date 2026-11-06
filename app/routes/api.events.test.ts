import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CLIENT_EVENTS } from "~/lib/analytics";

const analytics = vi.hoisted(() => ({
  findEventProductIds: vi.fn(),
  getVisitor: vi.fn(),
  isTrackingAllowed: vi.fn(),
  readVisitor: vi.fn(async () => ({})),
  trackEvents: vi.fn(),
}));

vi.mock("~/.server/analytics", () => analytics);

const { action } = await import("./api.events");
const { MAX_EVENTS_BODY_BYTES } = await import("~/.server/client-events");

type ActionArgs = Parameters<typeof action>[0];

const visitor = {
  anonymousId: "a",
  sessionId: "s",
  attribution: { trafficSource: "direct", trafficMedium: "none", trafficCampaign: null },
  headers: new Headers([["Set-Cookie", "analytics_session=s; Path=/; HttpOnly"]]),
};

let ip = 0;

/** A beacon from its own IP, so the rate limit doesn't carry over between tests. */
function beacon(body: string, { method = "POST", forwardedFor = `10.0.0.${++ip}` } = {}) {
  const request = new Request("http://localhost/api/events", {
    method,
    headers: { "Content-Type": "text/plain;charset=UTF-8", "X-Forwarded-For": forwardedFor },
    ...(method === "POST" ? { body } : {}),
  });
  return action({ request, params: {}, context: {} } as unknown as ActionArgs);
}

const pageView = { type: "page_view", path: "/catalog/women?sort=newest", referrer: "/" };

beforeEach(() => {
  vi.clearAllMocks();
  analytics.isTrackingAllowed.mockResolvedValue(true);
  analytics.getVisitor.mockResolvedValue(visitor);
  analytics.findEventProductIds.mockResolvedValue(new Map([[PRODUCT, 7]]));
});

const PRODUCT = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const UNKNOWN = "01a1652b-6e25-7c03-ae47-000000000000";
const shown = {
  product_public_id: PRODUCT,
  variant_id: "01a1652b-6e25-7d00-8000-000000000050",
  volume_ml: 50,
  price: "1890.00",
  in_stock: true,
  list_id: "catalog",
  list_position: 3,
};
const impression = { type: "product_impression", path: "/zhinochi", properties: shown };

describe("client events endpoint", () => {
  it("records the page views of a batch for the visitor", async () => {
    const second = { type: "page_view", path: "/products/abc", referrer: pageView.path };

    const response = await beacon(JSON.stringify({ events: [pageView, second] }));

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(["analytics_session=s; Path=/; HttpOnly"]);
    const [page] = analytics.getVisitor.mock.calls[0] as [Request];
    expect(page.url).toBe("http://localhost/catalog/women?sort=newest");
    expect(analytics.trackEvents).toHaveBeenCalledWith(visitor, page, [
      {
        type: "page_view",
        properties: { path: "/catalog/women?sort=newest" },
        referrer: "http://localhost/",
      },
      {
        type: "page_view",
        properties: { path: "/products/abc" },
        referrer: "http://localhost/catalog/women?sort=newest",
      },
    ]);
  });

  it("records product impressions, clicks and dwell with their product (#129)", async () => {
    const click = { type: "product_click", path: "/zhinochi", properties: shown };
    const dwell = {
      type: "product_dwell",
      path: "/parfumy/coco",
      referrer: "/zhinochi",
      properties: {
        ...shown,
        list_id: undefined,
        list_position: undefined,
        dwell_ms: 5000,
        max_scroll_pct: 40,
      },
    };

    const response = await beacon(JSON.stringify({ events: [impression, click, dwell] }));

    expect(response.status).toBe(204);
    expect(analytics.findEventProductIds).toHaveBeenCalledWith([PRODUCT, PRODUCT, PRODUCT]);
    const [, , inputs] = analytics.trackEvents.mock.calls[0] ?? [];
    expect(inputs).toEqual([
      { type: "product_impression", productId: 7, properties: shown },
      { type: "product_click", productId: 7, properties: shown },
      {
        type: "product_dwell",
        productId: 7,
        properties: {
          ...shown,
          list_id: undefined,
          list_position: undefined,
          dwell_ms: 5000,
          max_scroll_pct: 40,
        },
        referrer: "http://localhost/zhinochi",
      },
    ]);
  });

  it("drops events about products that don't exist (#129)", async () => {
    const unknown = { ...impression, properties: { ...shown, product_public_id: UNKNOWN } };

    expect((await beacon(JSON.stringify({ events: [unknown, impression] }))).status).toBe(204);
    const [, , inputs] = analytics.trackEvents.mock.calls[0] ?? [];
    expect(inputs).toEqual([{ type: "product_impression", productId: 7, properties: shown }]);

    vi.clearAllMocks();
    analytics.isTrackingAllowed.mockResolvedValue(true);
    analytics.getVisitor.mockResolvedValue(visitor);
    analytics.findEventProductIds.mockResolvedValue(new Map());
    expect((await beacon(JSON.stringify({ events: [unknown] }))).status).toBe(204);
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("refuses product events with the wrong shape (#129)", async () => {
    for (const bad of [
      { ...impression, properties: undefined },
      { ...impression, properties: { ...shown, list_position: 0 } },
      { ...impression, properties: { ...shown, email: "olena@example.com" } },
      { type: "product_view", path: "/", properties: shown },
    ]) {
      expect((await beacon(JSON.stringify({ events: [bad] }))).status).toBe(400);
    }
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("records no product events without consent (#129)", async () => {
    analytics.isTrackingAllowed.mockResolvedValueOnce(false);

    expect((await beacon(JSON.stringify({ events: [impression] }))).status).toBe(204);
    expect(analytics.findEventProductIds).not.toHaveBeenCalled();
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("takes a full batch of impressions within the body limit (#129)", async () => {
    const events = Array.from({ length: MAX_CLIENT_EVENTS }, (_, index) => ({
      ...impression,
      path: "/en/catalog/women?fragrance_family=%D0%9A%D0%B2%D1%96%D1%82%D0%BA%D0%BE%D0%B2%D1%96",
      properties: {
        ...shown,
        list_id: "search",
        list_position: index + 1,
        search_id: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11",
      },
    }));
    const body = JSON.stringify({ events });

    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(MAX_EVENTS_BODY_BYTES);
    expect((await beacon(body)).status).toBe(204);
    expect(analytics.trackEvents.mock.calls[0]?.[2]).toHaveLength(MAX_CLIENT_EVENTS);
  });

  it("refuses events only the server may record", async () => {
    for (const type of ["purchase", "add_to_cart", "login", "nonsense"]) {
      const response = await beacon(JSON.stringify({ events: [{ ...pageView, type }] }));
      expect(response.status).toBe(400);
    }
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("refuses malformed, empty and oversized batches", async () => {
    const tooMany = Array.from({ length: MAX_CLIENT_EVENTS + 1 }, () => pageView);

    expect((await beacon("not json")).status).toBe(400);
    expect((await beacon(JSON.stringify({ events: [] }))).status).toBe(400);
    expect((await beacon(JSON.stringify({ events: tooMany }))).status).toBe(400);
    const huge = JSON.stringify({ events: [pageView], padding: "x".repeat(MAX_EVENTS_BODY_BYTES) });
    expect((await beacon(huge)).status).toBe(413);
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("accepts only POST", async () => {
    const response = await beacon("", { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("records nothing without consent", async () => {
    analytics.isTrackingAllowed.mockResolvedValueOnce(false);

    expect((await beacon(JSON.stringify({ events: [pageView] }))).status).toBe(204);
    expect(analytics.getVisitor).not.toHaveBeenCalled();
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("limits how many batches one visitor can send", async () => {
    const body = JSON.stringify({ events: [pageView] });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      statuses.push((await beacon(body, { forwardedFor: "10.1.1.1" })).status);
    }
    expect(statuses.slice(0, 60).every((code) => code === 204)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("answers 204 when recording fails", async () => {
    analytics.getVisitor.mockRejectedValueOnce(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await beacon(JSON.stringify({ events: [pageView] }))).status).toBe(204);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
