import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://jassmin:jassmin@localhost:5432/jassmin",
  SESSION_SECRET: "a".repeat(32),
};

describe("parseEnv", () => {
  it("accepts a valid environment and coerces PORT", () => {
    const env = parseEnv({ ...valid, PORT: "4000", NODE_ENV: "production" });

    expect(env).toEqual({
      ...valid,
      PORT: 4000,
      NODE_ENV: "production",
      STRAPI_URL: "http://localhost:1337",
    });
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

  it("prefers the Aspire-injected JASSMINDB_URI over a DATABASE_URL from .env", () => {
    const env = parseEnv({
      ...valid,
      JASSMINDB_URI: "postgresql://postgres:secret@aspire/jassmindb",
    });

    expect(env.DATABASE_URL).toBe("postgresql://postgres:secret@aspire/jassmindb");
  });

  it("ignores an empty JASSMINDB_URI", () => {
    const env = parseEnv({ ...valid, JASSMINDB_URI: "" });

    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "too-short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a missing database URL", () => {
    expect(() => parseEnv({ SESSION_SECRET: valid.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });

  it("defaults STRAPI_URL to the local Strapi and leaves the API token unset", () => {
    const env = parseEnv(valid);

    expect(env.STRAPI_URL).toBe("http://localhost:1337");
    expect(env.STRAPI_API_TOKEN).toBeUndefined();
  });

  it("accepts an explicit STRAPI_URL and API token", () => {
    const env = parseEnv({
      ...valid,
      STRAPI_URL: "https://cms.jassmin.ua",
      STRAPI_API_TOKEN: "token",
    });

    expect(env.STRAPI_URL).toBe("https://cms.jassmin.ua");
    expect(env.STRAPI_API_TOKEN).toBe("token");
  });

  it("treats an empty STRAPI_API_TOKEN as unset", () => {
    expect(parseEnv({ ...valid, STRAPI_API_TOKEN: "" }).STRAPI_API_TOKEN).toBeUndefined();
  });

  it("falls back to the Aspire-injected CMS_HTTP", () => {
    const env = parseEnv({ ...valid, CMS_HTTP: "http://localhost:1337" });

    expect(env.STRAPI_URL).toBe("http://localhost:1337");
  });

  it("prefers STRAPI_URL over CMS_HTTP", () => {
    const env = parseEnv({ ...valid, STRAPI_URL: "http://cms:1337", CMS_HTTP: "http://other:1" });

    expect(env.STRAPI_URL).toBe("http://cms:1337");
  });

  it("rejects an invalid STRAPI_URL", () => {
    expect(() => parseEnv({ ...valid, STRAPI_URL: "not a url" })).toThrow(/STRAPI_URL/);
  });
});
