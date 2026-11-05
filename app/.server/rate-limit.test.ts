import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

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
