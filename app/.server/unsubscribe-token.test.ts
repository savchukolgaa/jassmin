import { describe, expect, it } from "vitest";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const secret = "s".repeat(32);

describe("unsubscribe tokens", () => {
  it("round-trips the user id and gives the same token every time", () => {
    const token = createUnsubscribeToken(42, secret);
    expect(token).toMatch(/^42\.[A-Za-z0-9_-]{43}$/);
    expect(createUnsubscribeToken(42, secret)).toBe(token);
    expect(verifyUnsubscribeToken(token, secret)).toBe(42);
  });

  it("refuses a tampered signature, another user's id and another secret", () => {
    const token = createUnsubscribeToken(42, secret);
    const signature = token.slice(3);
    const flipped = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyUnsubscribeToken(`42.${flipped}`, secret)).toBeUndefined();
    expect(verifyUnsubscribeToken(`43.${signature}`, secret)).toBeUndefined();
    expect(verifyUnsubscribeToken(token, "t".repeat(32))).toBeUndefined();
  });

  it("refuses malformed tokens", () => {
    const signature = createUnsubscribeToken(1, secret).slice(2);
    for (const token of [
      "",
      "42",
      "42.",
      ".abc",
      `0.${signature}`,
      `01.${signature}`,
      `-1.${signature}`,
      `1.${signature}x`,
      `1.${signature.slice(1)}`,
      `12345678901.${signature}`,
      `1.${signature.slice(0, -1)}=`,
    ]) {
      expect(verifyUnsubscribeToken(token, secret)).toBeUndefined();
    }
  });

  it("only signs positive whole user ids", () => {
    expect(() => createUnsubscribeToken(0, secret)).toThrow();
    expect(() => createUnsubscribeToken(1.5, secret)).toThrow();
  });
});
