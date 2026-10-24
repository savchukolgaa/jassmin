import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentCookie } from "~/.server/consent";

const analytics = vi.hoisted(() => ({
  getVisitor: vi.fn(),
  trackEvents: vi.fn(),
  clearAnalyticsSession: vi.fn(async () => "analytics_session=; Max-Age=0; Path=/"),
}));

vi.mock("~/.server/analytics", () => analytics);

const { action, loader } = await import("./consent");

type ActionArgs = Parameters<typeof action>[0];

function post(fields: Record<string, string>, headers: Record<string, string> = {}): ActionArgs {
  const request = new Request("http://localhost/consent", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers,
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** The `Set-Cookie` headers of the redirect, by cookie name. */
function cookiesOf(response: Response): Record<string, string> {
  return Object.fromEntries(
    response.headers.getSetCookie().map((cookie) => [cookie.split("=", 1)[0], cookie]),
  );
}

const visitor = {
  anonymousId: "a",
  sessionId: "s",
  attribution: { trafficSource: "google.com", trafficMedium: "referral", trafficCampaign: null },
  headers: new Headers([
    ["Set-Cookie", "anonymous_id=a; Path=/; HttpOnly"],
    ["Set-Cookie", "analytics_session=s; Path=/; HttpOnly"],
  ]),
};

beforeEach(() => {
  vi.clearAllMocks();
  analytics.getVisitor.mockResolvedValue(visitor);
});

describe("consent action", () => {
  it("stores the acceptance, starts the visit on the page and records its view", async () => {
    const response = (await action(
      post(
        {
          consent: "granted",
          redirectTo: "/catalog/women?utm_source=instagram",
          referrer: "https://www.google.com/",
        },
        { "User-Agent": "Mozilla/5.0", Referer: "http://localhost/catalog/women" },
      ),
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/catalog/women?utm_source=instagram");
    const cookies = cookiesOf(response);
    expect(await consentCookie.parse(cookies.cookie_consent?.split(";")[0] ?? "")).toBe("granted");
    expect(cookies.cookie_consent).toMatch(/Max-Age=31536000/);
    expect(cookies).toHaveProperty("anonymous_id");
    expect(cookies).toHaveProperty("analytics_session");

    const [page] = analytics.getVisitor.mock.calls[0] as [Request];
    expect(page.method).toBe("GET");
    expect(page.url).toBe("http://localhost/catalog/women?utm_source=instagram");
    expect(page.headers.get("Referer")).toBe("https://www.google.com/");
    expect(page.headers.get("User-Agent")).toBe("Mozilla/5.0");
    expect(analytics.trackEvents).toHaveBeenCalledWith(visitor, page, [
      { type: "page_view", properties: { path: "/catalog/women?utm_source=instagram" } },
    ]);
  });

  it("drops the in-site referrer of the form post when the page had none", async () => {
    await action(
      post({ consent: "granted", redirectTo: "/" }, { Referer: "http://localhost/blog" }),
    );

    const [page] = analytics.getVisitor.mock.calls[0] as [Request];
    expect(page.headers.get("Referer")).toBeNull();
  });

  it("still stores the answer when analytics fails", async () => {
    analytics.getVisitor.mockRejectedValueOnce(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = (await action(post({ consent: "granted", redirectTo: "/" }))) as Response;

    expect(response.status).toBe(302);
    expect(Object.keys(cookiesOf(response))).toEqual(["cookie_consent"]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("stores a refusal and ends the analytics session without tracking", async () => {
    const response = (await action(post({ consent: "denied", redirectTo: "/blog" }))) as Response;

    expect(response.headers.get("Location")).toBe("/blog");
    const cookies = cookiesOf(response);
    expect(await consentCookie.parse(cookies.cookie_consent?.split(";")[0] ?? "")).toBe("denied");
    expect(cookies.analytics_session).toMatch(/Max-Age=0/);
    expect(analytics.getVisitor).not.toHaveBeenCalled();
    expect(analytics.trackEvents).not.toHaveBeenCalled();
  });

  it("forgets the answer on reset, so the banner shows again", async () => {
    const response = (await action(post({ consent: "reset", redirectTo: "/cart" }))) as Response;

    expect(response.headers.get("Location")).toBe("/cart");
    expect(cookiesOf(response).cookie_consent).toMatch(/Max-Age=0/);
    expect(analytics.getVisitor).not.toHaveBeenCalled();
  });

  it("redirects home instead of to another site", async () => {
    const response = (await action(
      post({ consent: "denied", redirectTo: "//evil.com" }),
    )) as Response;
    expect(response.headers.get("Location")).toBe("/");
  });

  it("rejects an unknown answer without setting a cookie", async () => {
    const result = await action(post({ consent: "maybe" }));

    expect(result).not.toBeInstanceOf(Response);
    const { data, init } = result as { data: unknown; init?: { status?: number } };
    expect(init?.status).toBe(400);
    expect(data).toEqual({ ok: false, error: "invalid-consent" });
  });
});

describe("consent loader", () => {
  it("redirects a GET home", () => {
    const response = loader();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});
