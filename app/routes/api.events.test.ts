import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CLIENT_EVENTS } from "~/lib/analytics";

const analytics = vi.hoisted(() => ({
  getVisitor: vi.fn(),
  isTrackingAllowed: vi.fn(),
  readVisitor: vi.fn(async () => ({})),
  trackEvents: vi.fn(),
}));

vi.mock("~/.server/analytics", () => analytics);

const { action, MAX_BODY_BYTES } = await import("./api.events");

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
});

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
    const huge = JSON.stringify({ events: [pageView], padding: "x".repeat(MAX_BODY_BYTES) });
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
