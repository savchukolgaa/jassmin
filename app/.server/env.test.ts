import { describe, expect, it } from "vitest";
import {
  getDatabaseUrl,
  getSiteUrl,
  isLiqPaySandbox,
  parseAiEnv,
  parseCmsSyncEnv,
  parseEnv,
  parseMailEnv,
} from "./env";

const valid = {
  DATABASE_URL: "postgres://jassmin:jassmin@localhost:5432/jassmin",
  SESSION_SECRET: "a".repeat(32),
};

/** A complete production environment. */
const production = {
  ...valid,
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://jassmin.ua",
  SMTP_URL: "smtps://user:key@smtp-relay.example.com:465",
};

describe("parseEnv", () => {
  it("accepts a valid environment and coerces PORT", () => {
    const env = parseEnv({
      ...valid,
      PORT: "4000",
      NODE_ENV: "production",
      PUBLIC_SITE_URL: "https://jassmin.ua",
      SMTP_URL: "smtps://user:key@smtp-relay.example.com:465",
    });

    expect(env).toEqual({
      ...valid,
      PORT: 4000,
      NODE_ENV: "production",
      PUBLIC_SITE_URL: "https://jassmin.ua",
      SMTP_URL: "smtps://user:key@smtp-relay.example.com:465",
      STRAPI_URL: "http://localhost:1337",
      CSP_MODE: "report-only",
      TRUSTED_PROXY_HOPS: 0,
      CONTACT_INBOX: "hello@jassmin.ua",
      CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
      NEWSLETTER_DAILY_LIMIT: 200,
      AI_MODEL: "granite4.1:3b",
      AI_TIMEOUT_MS: 90_000,
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
  it("leaves card payment unconfigured by default and treats an empty value or none as unset", () => {
    expect(parseEnv(valid).PAYMENT_PROVIDER).toBeUndefined();
    expect(parseEnv({ ...valid, PAYMENT_PROVIDER: "" }).PAYMENT_PROVIDER).toBeUndefined();
    expect(parseEnv({ ...production, PAYMENT_PROVIDER: "none" }).PAYMENT_PROVIDER).toBeUndefined();
  });

  it("accepts the simulator outside production", () => {
    expect(parseEnv({ ...valid, PAYMENT_PROVIDER: "simulator" }).PAYMENT_PROVIDER).toBe(
      "simulator",
    );
  });

  it("refuses the simulator in production", () => {
    expect(() =>
      parseEnv({ ...production, PAYMENT_PROVIDER: "simulator", NODE_ENV: "production" }),
    ).toThrow(/PAYMENT_PROVIDER/);
  });

  it("rejects an unknown provider", () => {
    expect(() => parseEnv({ ...valid, PAYMENT_PROVIDER: "stripe" })).toThrow(/PAYMENT_PROVIDER/);
  });
});

describe("parseEnv: LiqPay", () => {
  const keys = { LIQPAY_PUBLIC_KEY: "sandbox_i123", LIQPAY_PRIVATE_KEY: "sandbox_secret" };

  it("accepts LiqPay with both keys, in development and production", () => {
    const env = parseEnv({ ...valid, PAYMENT_PROVIDER: "liqpay", ...keys });
    expect(env).toMatchObject({ PAYMENT_PROVIDER: "liqpay", ...keys });
    expect(parseEnv({ ...production, PAYMENT_PROVIDER: "liqpay", ...keys }).PAYMENT_PROVIDER).toBe(
      "liqpay",
    );
  });

  it("refuses LiqPay without its keys, and treats empty keys as missing", () => {
    expect(() => parseEnv({ ...valid, PAYMENT_PROVIDER: "liqpay" })).toThrow(/LIQPAY_PUBLIC_KEY/);
    expect(() =>
      parseEnv({ ...valid, PAYMENT_PROVIDER: "liqpay", ...keys, LIQPAY_PRIVATE_KEY: " " }),
    ).toThrow(/LIQPAY_PRIVATE_KEY/);
    // The deploy's placeholder until LiqPay approves the shop.
    expect(() =>
      parseEnv({
        ...production,
        PAYMENT_PROVIDER: "liqpay",
        ...keys,
        LIQPAY_PUBLIC_KEY: "pending",
      }),
    ).toThrow(/LIQPAY_PUBLIC_KEY/);
    expect(
      parseEnv({ ...production, PAYMENT_PROVIDER: "none", LIQPAY_PUBLIC_KEY: "pending" })
        .PAYMENT_PROVIDER,
    ).toBeUndefined();
  });

  it("doesn't need the keys while LiqPay isn't the provider", () => {
    expect(parseEnv(valid).LIQPAY_PUBLIC_KEY).toBeUndefined();
  });

  it("reads LIQPAY_SANDBOX as a boolean and LIQPAY_ORDER_PREFIX as a short id", () => {
    expect(parseEnv({ ...valid, LIQPAY_SANDBOX: "false" }).LIQPAY_SANDBOX).toBe(false);
    expect(parseEnv({ ...valid, LIQPAY_SANDBOX: "" }).LIQPAY_SANDBOX).toBeUndefined();
    expect(parseEnv({ ...valid, LIQPAY_ORDER_PREFIX: "dev-olga-" }).LIQPAY_ORDER_PREFIX).toBe(
      "dev-olga-",
    );
    expect(() => parseEnv({ ...valid, LIQPAY_ORDER_PREFIX: "a b" })).toThrow(/LIQPAY_ORDER_PREFIX/);
  });
});

describe("isLiqPaySandbox", () => {
  it("is on outside production and off in production unless LIQPAY_SANDBOX says otherwise", () => {
    expect(isLiqPaySandbox({ NODE_ENV: "development" })).toBe(true);
    expect(isLiqPaySandbox({ NODE_ENV: "test" })).toBe(true);
    expect(isLiqPaySandbox({ NODE_ENV: "production" })).toBe(false);
    expect(isLiqPaySandbox({ NODE_ENV: "production", LIQPAY_SANDBOX: true })).toBe(true);
    expect(isLiqPaySandbox({ NODE_ENV: "development", LIQPAY_SANDBOX: false })).toBe(false);
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

describe("parseEnv: TRUSTED_PROXY_HOPS", () => {
  it("defaults to 0 and treats an empty value as unset", () => {
    expect(parseEnv(valid).TRUSTED_PROXY_HOPS).toBe(0);
    expect(parseEnv({ ...valid, TRUSTED_PROXY_HOPS: "" }).TRUSTED_PROXY_HOPS).toBe(0);
  });

  it("coerces a whole number of hops and rejects anything else", () => {
    expect(parseEnv({ ...valid, TRUSTED_PROXY_HOPS: "2" }).TRUSTED_PROXY_HOPS).toBe(2);
    for (const value of ["-1", "1.5", "11", "many"]) {
      expect(() => parseEnv({ ...valid, TRUSTED_PROXY_HOPS: value })).toThrow(/TRUSTED_PROXY_HOPS/);
    }
  });
});

describe("parseEnv: AI perfumer", () => {
  it("leaves the perfumer off by default with granite4.1:3b and 90 s, empty values unset", () => {
    for (const env of [
      parseEnv(valid),
      parseEnv({
        ...valid,
        AI_BASE_URL: "",
        AI_MODEL: "",
        AI_API_KEY: "",
        AI_TIMEOUT_MS: "",
        AI_KEEP_ALIVE: "",
        AI_PROVIDER_NAME: "  ",
      }),
    ]) {
      expect(env.AI_BASE_URL).toBeUndefined();
      expect(env.AI_PROVIDER_NAME).toBeUndefined();
      expect(env.AI_API_KEY).toBeUndefined();
      expect(env.AI_KEEP_ALIVE).toBeUndefined();
      expect(env.AI_MODEL).toBe("granite4.1:3b");
      expect(env.AI_TIMEOUT_MS).toBe(90_000);
    }
  });

  it("accepts a base URL without its trailing slash, a model, key, timeout and keep-alive", () => {
    const env = parseEnv({
      ...valid,
      AI_BASE_URL: "http://localhost:11434/v1/",
      AI_MODEL: "granite4.1:8b",
      AI_API_KEY: "sk-test",
      AI_TIMEOUT_MS: "30000",
      AI_KEEP_ALIVE: "30m",
    });

    expect(env).toMatchObject({
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "granite4.1:8b",
      AI_API_KEY: "sk-test",
      AI_TIMEOUT_MS: 30_000,
      AI_KEEP_ALIVE: "30m",
    });
    expect(parseEnv({ ...valid, AI_KEEP_ALIVE: "-1" }).AI_KEEP_ALIVE).toBe("-1");
  });

  it("reads the provider's name for the privacy policy, trimmed (#167)", () => {
    expect(parseEnv({ ...valid, AI_PROVIDER_NAME: " OpenRouter " }).AI_PROVIDER_NAME).toBe(
      "OpenRouter",
    );
    expect(() => parseEnv({ ...valid, AI_PROVIDER_NAME: "x".repeat(81) })).toThrow(
      /AI_PROVIDER_NAME/,
    );
  });

  it("rejects a non-HTTP base URL, an out-of-range timeout and a bad keep-alive", () => {
    expect(() => parseEnv({ ...valid, AI_BASE_URL: "ftp://models.example.com" })).toThrow(
      /AI_BASE_URL/,
    );
    for (const value of ["500", "1.5", "600001", "soon"]) {
      expect(() => parseEnv({ ...valid, AI_TIMEOUT_MS: value })).toThrow(/AI_TIMEOUT_MS/);
    }
    expect(() => parseEnv({ ...valid, AI_KEEP_ALIVE: "forever" })).toThrow(/AI_KEEP_ALIVE/);
  });

  it("parseAiEnv reads only the AI variables", () => {
    expect(parseAiEnv({ AI_BASE_URL: "http://localhost:11434/v1" })).toEqual({
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "granite4.1:3b",
      AI_TIMEOUT_MS: 90_000,
    });
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
      parseMailEnv({
        SMTP_URL: "smtp://localhost:2525",
        ORDER_FROM: "",
        PUBLIC_SITE_URL: "",
        NODE_ENV: "production",
      }),
    ).toEqual({
      NODE_ENV: "production",
      SMTP_URL: "smtp://localhost:2525",
      CONTACT_INBOX: "hello@jassmin.ua",
      CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
      NEWSLETTER_DAILY_LIMIT: 200,
    });
  });

  it("rejects invalid mail variables", () => {
    expect(() => parseMailEnv({ SMTP_URL: "http://localhost:5000" })).toThrow(/SMTP_URL/);
  });

  it("requires SMTP_URL in production only", () => {
    expect(() => parseMailEnv({ NODE_ENV: "production" })).toThrow(/SMTP_URL is required/);
    expect(() => parseMailEnv({ NODE_ENV: "production", SMTP_URL: "" })).toThrow(/SMTP_URL/);
    expect(parseMailEnv({}).SMTP_URL).toBeUndefined();
  });

  it("reads PUBLIC_SITE_URL for the links in emails", () => {
    expect(parseMailEnv({ PUBLIC_SITE_URL: "https://jassmin.ua/" }).PUBLIC_SITE_URL).toBe(
      "https://jassmin.ua",
    );
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
    const { PUBLIC_SITE_URL: _, ...withoutSite } = production;
    expect(() => parseEnv(withoutSite)).toThrow(/PUBLIC_SITE_URL/);
    expect(() => parseEnv({ ...production, PUBLIC_SITE_URL: "" })).toThrow(/PUBLIC_SITE_URL/);
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

describe("SMTP_URL in production", () => {
  it("is required, so production doesn't start without a mail server", () => {
    const { SMTP_URL: _, ...withoutSmtp } = production;
    expect(() => parseEnv(withoutSmtp)).toThrow(/SMTP_URL is required in production/);
    expect(() => parseEnv({ ...production, SMTP_URL: "" })).toThrow(/SMTP_URL/);
    expect(parseEnv(production).SMTP_URL).toBe(production.SMTP_URL);
  });

  it("is optional outside production", () => {
    expect(parseEnv(valid).SMTP_URL).toBeUndefined();
  });
});

describe("EMAIL_WEBHOOK_SECRET", () => {
  it("is optional, also in production, and an empty value is unset", () => {
    expect(parseEnv(production).EMAIL_WEBHOOK_SECRET).toBeUndefined();
    expect(parseEnv({ ...valid, EMAIL_WEBHOOK_SECRET: "" }).EMAIL_WEBHOOK_SECRET).toBeUndefined();
  });

  it("accepts 32+ characters and rejects a short secret", () => {
    expect(parseEnv({ ...valid, EMAIL_WEBHOOK_SECRET: "w".repeat(32) }).EMAIL_WEBHOOK_SECRET).toBe(
      "w".repeat(32),
    );
    expect(() => parseEnv({ ...valid, EMAIL_WEBHOOK_SECRET: "short" })).toThrow(
      /EMAIL_WEBHOOK_SECRET/,
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

describe("EMAIL_UNSUBSCRIBE_SECRET", () => {
  it("is optional, also in production, and an empty value counts as unset", () => {
    expect(parseEnv(production).EMAIL_UNSUBSCRIBE_SECRET).toBeUndefined();
    expect(
      parseEnv({ ...valid, EMAIL_UNSUBSCRIBE_SECRET: "" }).EMAIL_UNSUBSCRIBE_SECRET,
    ).toBeUndefined();
    expect(parseMailEnv({ EMAIL_UNSUBSCRIBE_SECRET: "" }).EMAIL_UNSUBSCRIBE_SECRET).toBeUndefined();
  });

  it("is read by both schemas and must be 32+ characters", () => {
    const secret = "u".repeat(32);
    expect(parseEnv({ ...valid, EMAIL_UNSUBSCRIBE_SECRET: secret }).EMAIL_UNSUBSCRIBE_SECRET).toBe(
      secret,
    );
    expect(parseMailEnv({ EMAIL_UNSUBSCRIBE_SECRET: secret }).EMAIL_UNSUBSCRIBE_SECRET).toBe(
      secret,
    );
    expect(() => parseEnv({ ...valid, EMAIL_UNSUBSCRIBE_SECRET: "short" })).toThrow(
      /EMAIL_UNSUBSCRIBE_SECRET/,
    );
    expect(() => parseMailEnv({ EMAIL_UNSUBSCRIBE_SECRET: "short" })).toThrow(
      /EMAIL_UNSUBSCRIBE_SECRET/,
    );
  });
});

describe("NEWSLETTER_DAILY_LIMIT", () => {
  it("defaults to 200 in both schemas, and an empty value counts as unset", () => {
    expect(parseEnv(valid).NEWSLETTER_DAILY_LIMIT).toBe(200);
    expect(parseMailEnv({}).NEWSLETTER_DAILY_LIMIT).toBe(200);
    expect(parseMailEnv({ NEWSLETTER_DAILY_LIMIT: "" }).NEWSLETTER_DAILY_LIMIT).toBe(200);
  });

  it("takes a positive whole number", () => {
    expect(parseMailEnv({ NEWSLETTER_DAILY_LIMIT: "300" }).NEWSLETTER_DAILY_LIMIT).toBe(300);
    expect(() => parseMailEnv({ NEWSLETTER_DAILY_LIMIT: "0" })).toThrow(/NEWSLETTER_DAILY_LIMIT/);
    expect(() => parseMailEnv({ NEWSLETTER_DAILY_LIMIT: "2.5" })).toThrow(/NEWSLETTER_DAILY_LIMIT/);
  });
});
