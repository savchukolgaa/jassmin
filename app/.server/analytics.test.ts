import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasDatabase, type TestDatabase } from "./db/test-utils";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://jassmin:jassmin@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/** The `name=value` parts of the `Set-Cookie` headers, to send back as `Cookie`. */
function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function request(cookie?: string): Request {
  return new Request("http://localhost/products/abc", {
    headers: cookie ? { Cookie: cookie } : {},
  });
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

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("getVisitor", () => {
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
    const { eq } = await import("drizzle-orm");
    const { sessions } = await import("./db/schema");
    return testDb.db.select().from(sessions).where(eq(sessions.anonymousId, anonymousId));
  }

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

  it("reuses both ids on a repeat visit and sets no cookies", async () => {
    const { getVisitor } = await import("./analytics");
    const first = await getVisitor(request(), testDb.db);

    const again = await getVisitor(request(cookiesFrom(first.headers)), testDb.db);

    expect(again).toMatchObject({ anonymousId: first.anonymousId, sessionId: first.sessionId });
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(await sessionsOf(first.anonymousId)).toHaveLength(1);
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
});
