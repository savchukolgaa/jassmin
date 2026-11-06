import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, type TestDatabase } from "./db/test-utils";
import {
  createMemoryRateLimitStore,
  createPgRateLimitStore,
  createRateLimiter,
  passwordResetLimiters,
  type RateLimiter,
  type RateLimitStore,
  storedKey,
  verificationEmailLimiter,
} from "./rate-limit";

function setup(store: RateLimitStore = createMemoryRateLimitStore()) {
  let time = 0;
  const limiter = createRateLimiter({
    name: "test",
    limit: 3,
    windowMs: 1000,
    store,
    now: () => time,
  });
  return {
    limiter,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("blocks a key after the limit is reached", async () => {
    const { limiter } = setup();

    await limiter.hit("a");
    await limiter.hit("a");
    expect(await limiter.isBlocked("a")).toBe(false);

    await limiter.hit("a");
    expect(await limiter.isBlocked("a")).toBe(true);
    expect(await limiter.isBlocked("b")).toBe(false);
  });

  it("unblocks the key when the window expires", async () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) await limiter.hit("a");

    advance(999);
    expect(await limiter.isBlocked("a")).toBe(true);

    advance(1);
    expect(await limiter.isBlocked("a")).toBe(false);

    await limiter.hit("a");
    expect(await limiter.isBlocked("a")).toBe(false);
  });

  it("forgets a key on reset", async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) await limiter.hit("a");

    await limiter.reset("a");

    expect(await limiter.isBlocked("a")).toBe(false);
  });

  it("keeps limiters with different names apart in one store", async () => {
    const store = createMemoryRateLimitStore();
    const login = createRateLimiter({ name: "login", limit: 1, windowMs: 1000, store });
    const promo = createRateLimiter({ name: "promo", limit: 1, windowMs: 1000, store });

    await login.hit("203.0.113.7");

    expect(await login.isBlocked("203.0.113.7")).toBe(true);
    expect(await promo.isBlocked("203.0.113.7")).toBe(false);
  });
});

describe("storedKey", () => {
  it("prefixes the limiter's name to a SHA-256 of the key, never the key itself", () => {
    const key = storedKey("login-email", "olena@example.com");

    expect(key).toMatch(/^login-email:[0-9a-f]{64}$/);
    expect(key).not.toContain("olena");
    expect(storedKey("login-email", "olena@example.com")).toBe(key);
    expect(storedKey("login-ip", "olena@example.com")).not.toBe(key);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("rate limiter on PostgreSQL", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("./db/test-utils");
    const { migrateLatest } = await import("./db/migrator");
    testDb = await createTestDatabase("jassmin_rate_limiter_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  const store = () => createPgRateLimitStore(async () => testDb.db);
  const limiter = () =>
    createRateLimiter({ name: "login-email", limit: 3, windowMs: 60_000, store: store() });

  it("keeps a limit across a restart and shares it between instances", async () => {
    const before = limiter();
    for (let i = 0; i < 2; i++) await before.hit("olena@example.com");

    // A new limiter on the same table: the app restarted, or a second instance handles it.
    const after = limiter();
    expect(await after.isBlocked("olena@example.com")).toBe(false);
    await after.hit("olena@example.com");

    expect(await after.isBlocked("olena@example.com")).toBe(true);
    expect(await before.isBlocked("olena@example.com")).toBe(true);

    await before.reset("olena@example.com");
    expect(await after.isBlocked("olena@example.com")).toBe(false);
  });

  it("counts concurrent hits from several instances exactly", async () => {
    const instances = [limiter(), limiter(), limiter()];

    await Promise.all(
      Array.from({ length: 30 }, (_, i) => instances[i % 3]?.hit("busy@example.com")),
    );

    const { readRateLimit } = await import("./db/queries/rate-limits");
    const window = await readRateLimit(testDb.db, storedKey("login-email", "busy@example.com"));
    expect(window?.count).toBe(30);
  });

  it("stores no email or IP in plain text", async () => {
    await limiter().hit("plain@example.com");

    const { rateLimits } = await import("./db/schema");
    const keys = (await testDb.db.select({ key: rateLimits.key }).from(rateLimits)).map(
      (row) => row.key,
    );
    expect(keys.some((key) => key.includes("plain"))).toBe(false);
  });
});

describe("password reset and verification limits (#135)", () => {
  async function hitsUntilBlocked(limiter: RateLimiter): Promise<number> {
    const key = `test-${Math.random()}`;
    let hits = 0;
    while (!(await limiter.isBlocked(key)) && hits < 100) {
      await limiter.hit(key);
      hits += 1;
    }
    return hits;
  }

  it("allows 3 reset emails per address and 10 per IP", async () => {
    expect(await hitsUntilBlocked(passwordResetLimiters.byEmail)).toBe(3);
    expect(await hitsUntilBlocked(passwordResetLimiters.byIp)).toBe(10);
  });

  it("allows 3 verification emails per user", async () => {
    expect(await hitsUntilBlocked(verificationEmailLimiter)).toBe(3);
  });
});
