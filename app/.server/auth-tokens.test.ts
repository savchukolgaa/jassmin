import { describe, expect, it } from "vitest";
import { AUTH_TOKEN_LENGTH, generateAuthToken, hashAuthToken } from "./auth-tokens";

describe("auth tokens", () => {
  it("generates a 43-character base64url token and its SHA-256", () => {
    const { token, hash } = generateAuthToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(AUTH_TOKEN_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashAuthToken(token));
    expect(hash).not.toContain(token);
  });

  it("hashes deterministically with SHA-256", () => {
    expect(hashAuthToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("never generates the same token twice", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateAuthToken().token));
    expect(tokens.size).toBe(100);
  });
});
