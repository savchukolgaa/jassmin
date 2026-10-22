import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://jassmin:jassmin@localhost:5432/jassmin",
  SESSION_SECRET: "a".repeat(32),
};

describe("parseEnv", () => {
  it("accepts a valid environment and coerces PORT", () => {
    const env = parseEnv({ ...valid, PORT: "4000", NODE_ENV: "production" });

    expect(env).toEqual({ ...valid, PORT: 4000, NODE_ENV: "production" });
  });

  it("defaults PORT to 3000 and NODE_ENV to development", () => {
    const env = parseEnv(valid);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("falls back to the Aspire-injected JASSMINDB_URI", () => {
    const env = parseEnv({
      SESSION_SECRET: valid.SESSION_SECRET,
      JASSMINDB_URI: "postgresql://postgres:secret@localhost:55432/jassmindb",
    });

    expect(env.DATABASE_URL).toBe("postgresql://postgres:secret@localhost:55432/jassmindb");
  });

  it("prefers DATABASE_URL over JASSMINDB_URI", () => {
    const env = parseEnv({ ...valid, JASSMINDB_URI: "postgresql://other/db" });

    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "too-short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a missing database URL", () => {
    expect(() => parseEnv({ SESSION_SECRET: valid.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });
});
