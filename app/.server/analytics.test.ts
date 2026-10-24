import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** The `name=value` parts of the `Set-Cookie` headers, to send back as `Cookie`. */
function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function request(
  cookie?: string,
  { url = "http://localhost/products/abc", headers = {} as Record<string, string> } = {},
): Request {
  return new Request(url, {
    headers: { "User-Agent": DESKTOP, ...(cookie ? { Cookie: cookie } : {}), ...headers },
  });
}

/** `cookie_consent=granted`, as the consent route sets it. */
async function grantedCookie(): Promise<string> {
  const { serializeConsent } = await import("./consent");
  return (await serializeConsent("granted")).split(";")[0] ?? "";
}

describe("readVisitor", () => {
  it("has no ids without cookies", async () => {
    const { readVisitor } = await import("./analytics");

    expect(await readVisitor(request())).toEqual({});
  });

  it("ignores unsigned or tampered cookies", async () => {
    const { readVisitor } = await import("./analytics");
    const forged = "01a1652b-6e25-7c03-ae47-25b57131fb06";

    expect(
      await readVisitor(request(`anonymous_id=${forged}; analytics_session=${forged}`)),
    ).toEqual({});
  });
});

describe("isDocumentRequest", () => {
  it("counts full page loads only", async () => {
    const { isDocumentRequest } = await import("./analytics");
    const page = (headers: Record<string, string>, url = "http://localhost/blog") =>
      new Request(url, { headers });

    expect(isDocumentRequest(page({ "Sec-Fetch-Dest": "document" }))).toBe(true);
    expect(isDocumentRequest(page({ Accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isDocumentRequest(page({ "Sec-Fetch-Dest": "empty", Accept: "text/html" }))).toBe(false);
    expect(isDocumentRequest(page({ Accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest(page({ Accept: "text/html" }, "http://localhost/blog.data"))).toBe(
      false,
    );
    const post = new Request("http://localhost/cart", {
      method: "POST",
      headers: { "Sec-Fetch-Dest": "document" },
    });
    expect(isDocumentRequest(post)).toBe(false);
  });
});

describe("isTrackingAllowed", () => {
  it("needs consent and a person", async () => {
    const { isTrackingAllowed } = await import("./analytics");
    const { serializeConsent } = await import("./consent");
    const denied = (await serializeConsent("denied")).split(";")[0];
    const granted = await grantedCookie();

    expect(await isTrackingAllowed(request())).toBe(false);
    expect(await isTrackingAllowed(request(denied))).toBe(false);
    expect(await isTrackingAllowed(request(granted))).toBe(true);
    const bot = request(granted, { headers: { "User-Agent": "Googlebot/2.1" } });
    expect(await isTrackingAllowed(bot)).toBe(false);
  });
});

// Integration tests: run only when a database is configured, on their own throwaway database.
describe.skipIf(!hasDatabase)("analytics with a database", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./db/test-utils");
    const { migrateLatest } = await import("./db/migrator");
    testDb = await createTestDatabase("jassmin_analytics_test");
    await migrateLatest(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function sessionsOf(anonymousId: string) {
    const { asc, eq } = await import("drizzle-orm");
    const { sessions } = await import("./db/schema");
    return testDb.db
      .select()
      .from(sessions)
      .where(eq(sessions.anonymousId, anonymousId))
      .orderBy(asc(sessions.startedAt));
  }

  async function eventsOf(anonymousId: string) {
    const { eq } = await import("drizzle-orm");
    const { userEvents } = await import("./db/schema");
    return testDb.db.select().from(userEvents).where(eq(userEvents.anonymousId, anonymousId));
  }

  /** Moves the session's start and last activity `minutes` into the past. */
  async function age(sessionId: string, minutes: number) {
    const { eq, sql } = await import("drizzle-orm");
    const { sessions } = await import("./db/schema");
    const then = sql`now() - make_interval(mins => ${minutes})`;
    await testDb.db
      .update(sessions)
      .set({ startedAt: then, endedAt: then })
      .where(eq(sessions.sessionId, sessionId));
  }

  async function createUser(email: string): Promise<number> {
    const { users } = await import("./db/schema");
    const [user] = await testDb.db
      .insert(users)
      .values({ fullName: "Olha", email, passwordHash: "x" })
      .returning({ id: users.id });
    if (!user) throw new Error("no user");
    return user.id;
  }

  describe("getVisitor", () => {
    it("creates the anonymous id and a session on the first visit", async () => {
      const { getVisitor, readVisitor } = await import("./analytics");

      const visitor = await getVisitor(request(), testDb.db);

      const setCookies = visitor.headers.getSetCookie();
      expect(setCookies).toHaveLength(2);
      for (const cookie of setCookies) {
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
      }
      expect(await readVisitor(request(cookiesFrom(visitor.headers)))).toEqual({
        anonymousId: visitor.anonymousId,
        sessionId: visitor.sessionId,
      });
      expect(await sessionsOf(visitor.anonymousId)).toEqual([
        expect.objectContaining({ sessionId: visitor.sessionId, landingPage: "/products/abc" }),
      ]);
    });

    it("stores where the visit came from and the device", async () => {
      const { getVisitor } = await import("./analytics");
      const url =
        "http://localhost/catalog/women?utm_source=Instagram&utm_medium=cpc&utm_campaign=autumn";

      const visitor = await getVisitor(
        request(undefined, { url, headers: { "User-Agent": IPHONE } }),
        testDb.db,
      );

      const attribution = {
        trafficSource: "instagram",
        trafficMedium: "cpc",
        trafficCampaign: "autumn",
      };
      expect(visitor.attribution).toEqual(attribution);
      expect(await sessionsOf(visitor.anonymousId)).toEqual([
        expect.objectContaining({
          ...attribution,
          deviceType: "mobile",
          landingPage: "/catalog/women?utm_source=Instagram&utm_medium=cpc&utm_campaign=autumn",
        }),
      ]);
    });

    it("counts a link from another site as a referral and no source as direct", async () => {
      const { getVisitor } = await import("./analytics");

      const referred = await getVisitor(
        request(undefined, { headers: { Referer: "https://www.google.com/" } }),
        testDb.db,
      );
      const direct = await getVisitor(request(), testDb.db);

      expect(referred.attribution).toEqual({
        trafficSource: "google.com",
        trafficMedium: "referral",
        trafficCampaign: null,
      });
      expect(direct.attribution).toEqual({
        trafficSource: "direct",
        trafficMedium: "none",
        trafficCampaign: null,
      });
    });

    it("reuses both ids on a repeat visit, records the activity and sets no cookies", async () => {
      const { getVisitor } = await import("./analytics");
      const first = await getVisitor(request(), testDb.db);

      const again = await getVisitor(request(cookiesFrom(first.headers)), testDb.db);

      expect(again).toMatchObject({ anonymousId: first.anonymousId, sessionId: first.sessionId });
      expect(again.headers.getSetCookie()).toEqual([]);
      const [session, ...others] = await sessionsOf(first.anonymousId);
      expect(others).toEqual([]);
      expect(session?.endedAt).toBeInstanceOf(Date);
    });

    it("starts a new session for the same visitor after 30 minutes without a request", async () => {
      const { getVisitor } = await import("./analytics");
      const first = await getVisitor(request(), testDb.db);
      const cookies = cookiesFrom(first.headers);

      await age(first.sessionId, 29);
      const recent = await getVisitor(request(cookies), testDb.db);
      expect(recent.sessionId).toBe(first.sessionId);

      await age(first.sessionId, 31);
      const later = await getVisitor(request(cookies), testDb.db);
      expect(later.anonymousId).toBe(first.anonymousId);
      expect(later.sessionId).not.toBe(first.sessionId);
      expect(later.headers.getSetCookie()).toEqual([expect.stringMatching(/^analytics_session=/)]);
      expect(await sessionsOf(first.anonymousId)).toHaveLength(2);
    });

    it("starts a new session when a new campaign link is opened", async () => {
      const { getVisitor } = await import("./analytics");
      const first = await getVisitor(
        request(undefined, { url: "http://localhost/?utm_source=instagram" }),
        testDb.db,
      );
      const cookies = cookiesFrom(first.headers);

      const sameCampaign = await getVisitor(
        request(cookies, { url: "http://localhost/blog?utm_source=instagram" }),
        testDb.db,
      );
      const newCampaign = await getVisitor(
        request(cookies, { url: "http://localhost/?utm_source=facebook" }),
        testDb.db,
      );

      expect(sameCampaign.sessionId).toBe(first.sessionId);
      expect(newCampaign.sessionId).not.toBe(first.sessionId);
      expect(newCampaign.attribution.trafficSource).toBe("facebook");
    });

    it("starts a new session for the same visitor when the session row is gone", async () => {
      const { eq } = await import("drizzle-orm");
      const { sessions } = await import("./db/schema");
      const { getVisitor } = await import("./analytics");
      const first = await getVisitor(request(), testDb.db);
      await testDb.db.delete(sessions).where(eq(sessions.sessionId, first.sessionId));

      const again = await getVisitor(request(cookiesFrom(first.headers)), testDb.db);

      expect(again.anonymousId).toBe(first.anonymousId);
      expect(again.sessionId).not.toBe(first.sessionId);
      expect(again.headers.getSetCookie()).toEqual([expect.stringMatching(/^analytics_session=/)]);
    });

    it("stores nothing about the visit without consent, and replaces that session once it's given", async () => {
      const { getVisitor } = await import("./analytics");
      const url = "http://localhost/?utm_source=instagram";

      const untracked = await getVisitor(request(undefined, { url }), testDb.db, {
        track: false,
      });
      expect(untracked.attribution).toEqual({
        trafficSource: null,
        trafficMedium: null,
        trafficCampaign: null,
      });
      expect(await sessionsOf(untracked.anonymousId)).toEqual([
        expect.objectContaining({ landingPage: null, deviceType: null, trafficSource: null }),
      ]);

      const cookies = cookiesFrom(untracked.headers);
      const stillUntracked = await getVisitor(request(cookies), testDb.db, { track: false });
      expect(stillUntracked.sessionId).toBe(untracked.sessionId);

      const tracked = await getVisitor(request(cookies, { url }), testDb.db);
      expect(tracked.anonymousId).toBe(untracked.anonymousId);
      expect(tracked.sessionId).not.toBe(untracked.sessionId);
      expect(tracked.attribution.trafficSource).toBe("instagram");
    });
  });

  describe("ensureVisitor", () => {
    it("reuses the visitor in the context, or creates and stores one", async () => {
      const { ensureVisitor, visitorContext } = await import("./analytics");
      const context = new RouterContextProvider();

      const created = await ensureVisitor({ request: request(), context }, testDb.db);
      expect(context.get(visitorContext)).toBe(created);
      // No consent: a session for the cart, without anything about the visit.
      expect(created.attribution.trafficSource).toBeNull();

      expect(await ensureVisitor({ request: request(), context }, testDb.db)).toBe(created);
      expect(await sessionsOf(created.anonymousId)).toHaveLength(1);
    });
  });

  describe("trackEvent", () => {
    async function visitorIn(context: RouterContextProvider, req: Request) {
      const { getVisitor, visitorContext } = await import("./analytics");
      const visitor = await getVisitor(req, testDb.db);
      context.set(visitorContext, visitor);
      return visitor;
    }

    it("records the event with the visit's source and the request's device and referrer", async () => {
      const { trackEvent } = await import("./analytics");
      const context = new RouterContextProvider();
      const landing = request(await grantedCookie(), {
        url: "http://localhost/?utm_source=instagram&utm_medium=cpc",
      });
      const visitor = await visitorIn(context, landing);
      const later = request(await grantedCookie(), {
        url: "http://localhost/catalog/women",
        headers: { "User-Agent": IPHONE, Referer: "http://localhost/" },
      });

      await trackEvent(
        { request: later, context },
        "search",
        {
          properties: { query: "rose" },
        },
        testDb.db,
      );

      expect(await eventsOf(visitor.anonymousId)).toEqual([
        expect.objectContaining({
          sessionId: visitor.sessionId,
          userId: null,
          eventType: "search",
          productId: null,
          eventProperties: { query: "rose" },
          source: "instagram",
          medium: "cpc",
          campaign: null,
          deviceType: "mobile",
          referrer: "http://localhost/",
        }),
      ]);
    });

    it("records nothing without consent or without a visitor", async () => {
      const { trackEvent } = await import("./analytics");
      const context = new RouterContextProvider();
      const visitor = await visitorIn(context, request());

      await trackEvent({ request: request(), context }, "page_view", {}, testDb.db);
      await trackEvent(
        { request: request(await grantedCookie()), context: new RouterContextProvider() },
        "page_view",
        {},
        testDb.db,
      );

      expect(await eventsOf(visitor.anonymousId)).toEqual([]);
    });

    it("never rejects when the insert fails", async () => {
      const { trackEvent, visitorContext } = await import("./analytics");
      const context = new RouterContextProvider();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      context.set(visitorContext, {
        anonymousId: "ghost",
        sessionId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
        attribution: { trafficSource: null, trafficMedium: null, trafficCampaign: null },
        headers: new Headers(),
      });

      await expect(
        trackEvent(
          { request: request(await grantedCookie()), context },
          "page_view",
          {},
          testDb.db,
        ),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe("linkVisitorToUser", () => {
    it("gives the visitor's anonymous rows to the user and stores the first touch once", async () => {
      const { getVisitor, linkVisitorToUser, trackEvents } = await import("./analytics");
      const userId = await createUser("link@example.com");
      const first = await getVisitor(
        request(undefined, { url: "http://localhost/?utm_source=instagram&utm_campaign=autumn" }),
        testDb.db,
      );
      await age(first.sessionId, 60 * 24);
      const second = await getVisitor(
        request(cookiesFrom(first.headers), { url: "http://localhost/?utm_source=google" }),
        testDb.db,
      );
      await trackEvents(second, request(), [{ type: "page_view" }], { db: testDb.db });
      const stranger = await getVisitor(request(), testDb.db);
      await trackEvents(stranger, request(), [{ type: "page_view" }], { db: testDb.db });

      await linkVisitorToUser(first.anonymousId, userId, testDb.db);

      for (const session of await sessionsOf(first.anonymousId)) {
        expect(session.userId).toBe(userId);
      }
      expect(await eventsOf(first.anonymousId)).toEqual([expect.objectContaining({ userId })]);
      expect(await eventsOf(stranger.anonymousId)).toEqual([
        expect.objectContaining({ userId: null }),
      ]);

      const { eq } = await import("drizzle-orm");
      const { users } = await import("./db/schema");
      const firstTouch = {
        firstTouchSource: "instagram",
        firstTouchMedium: null,
        firstTouchCampaign: "autumn",
      };
      const [user] = await testDb.db.select().from(users).where(eq(users.id, userId));
      expect(user).toMatchObject(firstTouch);

      // Logging in later from another browser doesn't overwrite it.
      await linkVisitorToUser(stranger.anonymousId, userId, testDb.db);
      const [after] = await testDb.db.select().from(users).where(eq(users.id, userId));
      expect(after).toMatchObject(firstTouch);
    });
  });
});
