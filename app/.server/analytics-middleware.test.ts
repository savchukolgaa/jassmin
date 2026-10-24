import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import { hasDatabase, type TestDatabase } from "./db/test-utils";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://jassmin:jassmin@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function consentCookie(consent: "granted" | "denied"): Promise<string> {
  const { serializeConsent } = await import("./consent");
  return (await serializeConsent(consent)).split(";")[0] ?? "";
}

function page(
  cookie: string,
  { userAgent = DESKTOP, dest = "document", url = "http://localhost/blog?page=2" } = {},
): Request {
  return new Request(url, {
    headers: { Cookie: cookie, "User-Agent": userAgent, "Sec-Fetch-Dest": dest },
  });
}

/** Runs the middleware around a handler that returns a cacheable page. */
async function run(db: Db, request: Request, context = new RouterContextProvider()) {
  const { createVisitorMiddleware } = await import("./analytics-middleware");
  const middleware = createVisitorMiddleware(db);
  type Args = Parameters<typeof middleware>[0];
  const next = vi.fn(
    async () =>
      new Response("<html></html>", { headers: { "Cache-Control": "public, max-age=60" } }),
  );
  const response = await middleware({ request, context, params: {} } as unknown as Args, next);
  if (!(response instanceof Response)) throw new Error("no response");
  return { response, context, next };
}

describe.skipIf(!hasDatabase)("visitor middleware", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./db/test-utils");
    const { migrateLatest } = await import("./db/migrator");
    testDb = await createTestDatabase("jassmin_analytics_middleware_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function rowsOf(anonymousId: string) {
    const { eq } = await import("drizzle-orm");
    const { sessions, userEvents } = await import("./db/schema");
    const [sessionRows, eventRows] = await Promise.all([
      testDb.db.select().from(sessions).where(eq(sessions.anonymousId, anonymousId)),
      testDb.db.select().from(userEvents).where(eq(userEvents.anonymousId, anonymousId)),
    ]);
    return { sessions: sessionRows, events: eventRows };
  }

  async function countRows() {
    const { count } = await import("drizzle-orm");
    const { sessions } = await import("./db/schema");
    const [row] = await testDb.db.select({ n: count() }).from(sessions);
    return row?.n ?? 0;
  }

  /** Waits for the fire-and-forget `page_view` insert. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  it("creates the visitor and records a page view for a consented page load", async () => {
    const { visitorContext } = await import("./analytics");

    const { response, context } = await run(testDb.db, page(await consentCookie("granted")));
    await settle();

    const visitor = context.get(visitorContext);
    expect(visitor).not.toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^anonymous_id=/),
      expect.stringMatching(/^analytics_session=/),
    ]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const rows = await rowsOf(visitor?.anonymousId ?? "");
    expect(rows.sessions).toEqual([
      expect.objectContaining({ landingPage: "/blog?page=2", trafficSource: "direct" }),
    ]);
    expect(rows.events).toEqual([
      expect.objectContaining({
        eventType: "page_view",
        eventProperties: { path: "/blog?page=2" },
      }),
    ]);
  });

  it("records no page view for a client navigation's data request", async () => {
    const { visitorContext } = await import("./analytics");

    const { context } = await run(
      testDb.db,
      page(await consentCookie("granted"), { dest: "empty" }),
    );
    await settle();

    const visitor = context.get(visitorContext);
    expect(visitor).not.toBeNull();
    expect((await rowsOf(visitor?.anonymousId ?? "")).events).toEqual([]);
  });

  it("does nothing without consent or for bots", async () => {
    const before = await countRows();

    for (const request of [
      page(""),
      page(await consentCookie("denied")),
      page(await consentCookie("granted"), { userAgent: "Googlebot/2.1" }),
    ]) {
      const { response } = await run(testDb.db, request);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    }

    await settle();
    expect(await countRows()).toBe(before);
  });

  it("sends the cookies of a visitor created later by the action", async () => {
    const { ensureVisitor } = await import("./analytics");
    const { createVisitorMiddleware } = await import("./analytics-middleware");
    const middleware = createVisitorMiddleware(testDb.db);
    type Args = Parameters<typeof middleware>[0];
    const request = page("");
    const context = new RouterContextProvider();

    const response = await middleware(
      { request, context, params: {} } as unknown as Args,
      async () => {
        await ensureVisitor({ request, context }, testDb.db);
        return new Response(null);
      },
    );

    expect((response as Response).headers.getSetCookie()).toHaveLength(2);
  });

  it("still serves the page when the visitor can't be stored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {} as Db;

    const { response, next } = await run(broken, page(await consentCookie("granted")));

    expect(next).toHaveBeenCalled();
    expect(await response.text()).toBe("<html></html>");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
