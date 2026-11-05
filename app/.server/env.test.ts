import { describe, expect, it } from "vitest";
import { getDatabaseUrl, getSiteUrl, parseCmsSyncEnv, parseEnv, parseMailEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://jassmin:jassmin@localhost:5432/jassmin",
  SESSION_SECRET: "a".repeat(32),
};

describe("parseEnv", () => {
  it("accepts a valid environment and coerces PORT", () => {
    const env = parseEnv({
      ...valid,
      PORT: "4000",
      NODE_ENV: "production",
      PUBLIC_SITE_URL: "https://jassmin.ua",
    });

    expect(env).toEqual({
      ...valid,
      PORT: 4000,
      NODE_ENV: "production",
      PUBLIC_SITE_URL: "https://jassmin.ua",
      STRAPI_URL: "http://localhost:1337",
      CSP_MODE: "report-only",
      CONTACT_INBOX: "hello@jassmin.ua",
      CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
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

  it("leaves the CMS sync secret and token unset by default and treats empty ones as unset", () => {
    for (const env of [
      parseEnv(valid),
      parseEnv({ ...valid, CMS_SYNC_SECRET: "", STRAPI_SYNC_TOKEN: "" }),
    ]) {
      expect(env.CMS_SYNC_SECRET).toBeUndefined();
      expect(env.STRAPI_SYNC_TOKEN).toBeUndefined();
    }
  });

  it("accepts a CMS sync secret and token, and rejects a short secret", () => {
    const env = parseEnv({ ...valid, CMS_SYNC_SECRET: "s".repeat(32), STRAPI_SYNC_TOKEN: "write" });

    expect(env.CMS_SYNC_SECRET).toBe("s".repeat(32));
    expect(env.STRAPI_SYNC_TOKEN).toBe("write");
    expect(() => parseEnv({ ...valid, CMS_SYNC_SECRET: "short" })).toThrow(/CMS_SYNC_SECRET/);
  });
});

describe("parseEnv: PAYMENT_PROVIDER", () => {
  it("leaves card payment unconfigured by default and treats an empty value as unset", () => {
    expect(parseEnv(valid).PAYMENT_PROVIDER).toBeUndefined();
    expect(parseEnv({ ...valid, PAYMENT_PROVIDER: "" }).PAYMENT_PROVIDER).toBeUndefined();
  });

  it("accepts the simulator outside production", () => {
    expect(parseEnv({ ...valid, PAYMENT_PROVIDER: "simulator" }).PAYMENT_PROVIDER).toBe(
      "simulator",
    );
  });

  it("refuses the simulator in production", () => {
    expect(() =>
      parseEnv({ ...valid, PAYMENT_PROVIDER: "simulator", NODE_ENV: "production" }),
    ).toThrow(/PAYMENT_PROVIDER/);
  });

  it("rejects an unknown provider", () => {
    expect(() => parseEnv({ ...valid, PAYMENT_PROVIDER: "liqpay" })).toThrow(/PAYMENT_PROVIDER/);
  });
});

describe("parseEnv: ROBOTS_DISALLOW_ALL", () => {
  it("is unset by default and treats an empty value as unset", () => {
    expect(parseEnv(valid).ROBOTS_DISALLOW_ALL).toBeUndefined();
    expect(parseEnv({ ...valid, ROBOTS_DISALLOW_ALL: "" }).ROBOTS_DISALLOW_ALL).toBeUndefined();
  });

  it("parses boolean strings", () => {
    expect(parseEnv({ ...valid, ROBOTS_DISALLOW_ALL: "true" }).ROBOTS_DISALLOW_ALL).toBe(true);
    expect(parseEnv({ ...valid, ROBOTS_DISALLOW_ALL: "1" }).ROBOTS_DISALLOW_ALL).toBe(true);
    expect(parseEnv({ ...valid, ROBOTS_DISALLOW_ALL: "false" }).ROBOTS_DISALLOW_ALL).toBe(false);
  });

  it("rejects anything else", () => {
    expect(() => parseEnv({ ...valid, ROBOTS_DISALLOW_ALL: "maybe" })).toThrow(
      /ROBOTS_DISALLOW_ALL/,
    );
  });
});

describe("parseEnv: CSP_MODE", () => {
  it("defaults to report-only and treats an empty value as unset", () => {
    expect(parseEnv(valid).CSP_MODE).toBe("report-only");
    expect(parseEnv({ ...valid, CSP_MODE: "" }).CSP_MODE).toBe("report-only");
  });

  it("accepts enforce and rejects anything else", () => {
    expect(parseEnv({ ...valid, CSP_MODE: "enforce" }).CSP_MODE).toBe("enforce");
    expect(() => parseEnv({ ...valid, CSP_MODE: "off" })).toThrow(/CSP_MODE/);
  });
});

describe("getDatabaseUrl", () => {
  it("prefers JASSMINDB_URI over DATABASE_URL", () => {
    expect(
      getDatabaseUrl({ JASSMINDB_URI: "postgres://aspire", DATABASE_URL: "postgres://env" }),
    ).toBe("postgres://aspire");
  });

  it("falls back to DATABASE_URL when JASSMINDB_URI is empty", () => {
    expect(getDatabaseUrl({ JASSMINDB_URI: "", DATABASE_URL: "postgres://env" })).toBe(
      "postgres://env",
    );
  });

  it("returns undefined when neither is set", () => {
    expect(getDatabaseUrl({})).toBeUndefined();
  });

  it("leaves SMTP unset by default and treats empty mail variables as unset", () => {
    const env = parseEnv({
      ...valid,
      SMTP_URL: "",
      CONTACT_INBOX: "",
      CONTACT_FROM: "",
      ORDER_FROM: "",
    });

    expect(env.SMTP_URL).toBeUndefined();
    expect(env.ORDER_FROM).toBeUndefined();
    expect(env.CONTACT_INBOX).toBe("hello@jassmin.ua");
    expect(env.CONTACT_FROM).toBe("Jassmin website <no-reply@jassmin.ua>");
  });

  it("accepts smtp and smtps URLs and custom mail addresses", () => {
    const env = parseEnv({
      ...valid,
      SMTP_URL: "smtp://localhost:2525",
      CONTACT_INBOX: "shop@example.com",
      CONTACT_FROM: "Shop <no-reply@example.com>",
      ORDER_FROM: "Shop orders <orders@example.com>",
    });

    expect(env).toMatchObject({
      SMTP_URL: "smtp://localhost:2525",
      CONTACT_INBOX: "shop@example.com",
      CONTACT_FROM: "Shop <no-reply@example.com>",
      ORDER_FROM: "Shop orders <orders@example.com>",
    });
    expect(
      parseEnv({ ...valid, SMTP_URL: "smtps://user:pass@mail.example.com:465" }).SMTP_URL,
    ).toBe("smtps://user:pass@mail.example.com:465");
  });

  it("rejects a non-SMTP SMTP_URL and an invalid CONTACT_INBOX", () => {
    expect(() => parseEnv({ ...valid, SMTP_URL: "http://localhost:5000" })).toThrow(/SMTP_URL/);
    expect(() => parseEnv({ ...valid, CONTACT_INBOX: "not-an-email" })).toThrow(/CONTACT_INBOX/);
  });
});

describe("parseMailEnv", () => {
  it("reads the mail variables without the web app's", () => {
    expect(
      parseMailEnv({ SMTP_URL: "smtp://localhost:2525", ORDER_FROM: "", NODE_ENV: "production" }),
    ).toEqual({
      NODE_ENV: "production",
      SMTP_URL: "smtp://localhost:2525",
      CONTACT_INBOX: "hello@jassmin.ua",
      CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
    });
  });

  it("rejects invalid mail variables", () => {
    expect(() => parseMailEnv({ SMTP_URL: "http://localhost:5000" })).toThrow(/SMTP_URL/);
  });
});

describe("parseCmsSyncEnv", () => {
  it("reads the Strapi URL and sync token without the web app's variables", () => {
    expect(parseCmsSyncEnv({ CMS_HTTP: "http://cms:1337", STRAPI_SYNC_TOKEN: "write" })).toEqual({
      STRAPI_URL: "http://cms:1337",
      STRAPI_SYNC_TOKEN: "write",
    });
    expect(parseCmsSyncEnv({ STRAPI_SYNC_TOKEN: "" })).toEqual({
      STRAPI_URL: "http://localhost:1337",
    });
  });

  it("rejects an invalid STRAPI_URL", () => {
    expect(() => parseCmsSyncEnv({ STRAPI_URL: "nope" })).toThrow(/STRAPI_URL/);
  });
});

describe("PUBLIC_SITE_URL", () => {
  it("is required in production", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production" })).toThrow(/PUBLIC_SITE_URL/);
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", PUBLIC_SITE_URL: "" })).toThrow(
      /PUBLIC_SITE_URL/,
    );
  });

  it("is optional outside production", () => {
    expect(parseEnv(valid).PUBLIC_SITE_URL).toBeUndefined();
  });

  it("drops a trailing slash and refuses non-http URLs", () => {
    expect(parseEnv({ ...valid, PUBLIC_SITE_URL: "https://jassmin.ua/" }).PUBLIC_SITE_URL).toBe(
      "https://jassmin.ua",
    );
    expect(() => parseEnv({ ...valid, PUBLIC_SITE_URL: "ftp://jassmin.ua" })).toThrow(
      /PUBLIC_SITE_URL/,
    );
  });
});

describe("getSiteUrl", () => {
  const request = new Request("http://evil.example:5173/catalog/women?x=1");

  it("uses PUBLIC_SITE_URL, not the request's host", () => {
    expect(getSiteUrl({ PUBLIC_SITE_URL: "https://jassmin.ua" }, request)).toBe(
      "https://jassmin.ua",
    );
  });

  it("falls back to the request's origin when unset", () => {
    expect(getSiteUrl({ PUBLIC_SITE_URL: undefined }, request)).toBe("http://evil.example:5173");
  });
});
