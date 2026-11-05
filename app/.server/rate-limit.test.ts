import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  getClientIp,
  passwordResetLimiters,
  verificationEmailLimiter,
} from "./rate-limit";

function setup() {
  let time = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => time });
  return {
    limiter,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("blocks a key after the limit is reached", () => {
    const { limiter } = setup();

    limiter.hit("a");
    limiter.hit("a");
    expect(limiter.isBlocked("a")).toBe(false);

    limiter.hit("a");
    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.isBlocked("b")).toBe(false);
  });

  it("unblocks the key when the window expires", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.hit("a");

    advance(999);
    expect(limiter.isBlocked("a")).toBe(true);

    advance(1);
    expect(limiter.isBlocked("a")).toBe(false);

    limiter.hit("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("forgets a key on reset", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.hit("a");

    limiter.reset("a");

    expect(limiter.isBlocked("a")).toBe(false);
  });
});

describe("password reset and verification limits (#135)", () => {
  function hitsUntilBlocked(limiter: { isBlocked(k: string): boolean; hit(k: string): void }) {
    const key = `test-${Math.random()}`;
    let hits = 0;
    while (!limiter.isBlocked(key) && hits < 100) {
      limiter.hit(key);
      hits += 1;
    }
    return hits;
  }

  it("allows 3 reset emails per address and 10 per IP", () => {
    expect(hitsUntilBlocked(passwordResetLimiters.byEmail)).toBe(3);
    expect(hitsUntilBlocked(passwordResetLimiters.byIp)).toBe(10);
  });

  it("allows 3 verification emails per user", () => {
    expect(hitsUntilBlocked(verificationEmailLimiter)).toBe(3);
  });
});

describe("getClientIp", () => {
  it("returns the first X-Forwarded-For entry", () => {
    const request = new Request("http://localhost/", {
      headers: { "X-Forwarded-For": " 203.0.113.7 , 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("returns undefined without the header", () => {
    expect(getClientIp(new Request("http://localhost/"))).toBeUndefined();
  });
});
