import { describe, expect, it } from "vitest";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("produces an argon2id hash that doesn't contain the password", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery");
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
  });

  it("returns false for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});

describe("getDummyPasswordHash", () => {
  it("returns the same argon2id hash every time", async () => {
    const hash = await getDummyPasswordHash();

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await getDummyPasswordHash()).toBe(hash);
  });
});
