import { type MiddlewareFunction, RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  buildCsp,
  buildSecurityHeaders,
  createNonce,
  createSecurityHeadersMiddleware,
  nonceContext,
} from "./security-headers";

type HeaderEnv = Parameters<typeof buildSecurityHeaders>[0]["env"];

const devEnv: HeaderEnv = {
  NODE_ENV: "development",
  PUBLIC_SITE_URL: undefined,
  STRAPI_URL: "http://localhost:1337",
  CSP_MODE: "report-only",
};

const prodEnv: HeaderEnv = {
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://jassmin.ua",
  STRAPI_URL: "https://cms.jassmin.ua/",
  CSP_MODE: "enforce",
};

/** The policy as `{ directive: sources }`. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name = "", ...sources] = part.split(" ");
      return [name, sources];
    }),
  );
}

describe("buildCsp", () => {
  const policy = directives(
    buildCsp({ nonce: "abc123==", strapiOrigin: "https://cms.jassmin.ua", isDev: false }),
  );

  it("allows scripts only by nonce, with strict-dynamic and never unsafe-inline", () => {
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("locks down framing, base, forms and plugins", () => {
    expect(policy).toMatchObject({
      "default-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "object-src": ["'none'"],
    });
  });

  it("allows CMS images and the map frame", () => {
    expect(policy["img-src"]).toEqual(["'self'", "data:", "https://cms.jassmin.ua"]);
    expect(policy["frame-src"]).toEqual(["https://www.google.com", "https://maps.google.com"]);
  });

  it("reports violations to /csp-report", () => {
    expect(policy["report-uri"]).toEqual(["/csp-report"]);
    expect(policy["report-to"]).toEqual(["csp"]);
  });

  it("allows Vite's HMR socket in development only", () => {
    const dev = directives(buildCsp({ nonce: "n", strapiOrigin: "http://x", isDev: true }));
    expect(dev["connect-src"]).toEqual(["'self'", "ws:"]);
  });
});

describe("buildSecurityHeaders", () => {
  it("sends the CSP as report-only by default, with the reporting endpoint", () => {
    const headers = buildSecurityHeaders({ env: devEnv, html: true, nonce: "n1" });

    expect(headers.get("Content-Security-Policy")).toBeNull();
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain("'nonce-n1'");
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain(
      "img-src 'self' data: http://localhost:1337;",
    );
    expect(headers.get("Reporting-Endpoints")).toBe('csp="/csp-report"');
  });

  it("enforces the CSP when CSP_MODE=enforce, with the Strapi origin only", () => {
    const headers = buildSecurityHeaders({ env: prodEnv, html: true, nonce: "n2" });

    expect(headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(headers.get("Content-Security-Policy")).toContain(
      "img-src 'self' data: https://cms.jassmin.ua;",
    );
  });

  it("sends the other headers on every response, and no CSP on non-HTML ones", () => {
    const headers = buildSecurityHeaders({ env: devEnv, html: false, nonce: "n" });

    expect(Object.fromEntries(headers)).toEqual({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "x-frame-options": "DENY",
      "cross-origin-opener-policy": "same-origin",
    });
  });

  it("sends HSTS only in production over https", () => {
    const hsts = (env: HeaderEnv) =>
      buildSecurityHeaders({ env, html: false, nonce: "n" }).get("Strict-Transport-Security");

    expect(hsts(prodEnv)).toBe("max-age=31536000; includeSubDomains");
    expect(hsts(devEnv)).toBeNull();
    expect(hsts({ ...devEnv, PUBLIC_SITE_URL: "https://jassmin.ua" })).toBeNull();
    expect(hsts({ ...prodEnv, PUBLIC_SITE_URL: "http://jassmin.ua" })).toBeNull();
  });
});

describe("createNonce", () => {
  it("returns 128 random bits in base64, different each time", () => {
    const nonce = createNonce();
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    expect(createNonce()).not.toBe(nonce);
  });
});

describe("securityHeadersMiddleware", () => {
  type Args = Parameters<MiddlewareFunction<Response>>[0];

  async function run(response: Response) {
    const middleware = createSecurityHeadersMiddleware(() => devEnv);
    const context = new RouterContextProvider();
    let nonceDuringNext: string | undefined;
    const result = await middleware(
      { request: new Request("http://localhost/"), context, params: {} } as unknown as Args,
      async () => {
        nonceDuringNext = context.get(nonceContext);
        return response;
      },
    );
    return { result: result as Response, nonce: nonceDuringNext ?? "" };
  }

  const html = () => new Response("<!DOCTYPE html>", { headers: { "Content-Type": "text/html" } });

  it("gives a page the CSP with the nonce the render saw", async () => {
    const { result, nonce } = await run(html());

    expect(nonce).not.toBe("");
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toContain(`'nonce-${nonce}'`);
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("uses a new nonce for every request", async () => {
    const first = await run(html());
    const second = await run(html());

    expect(first.nonce).not.toBe(second.nonce);
  });

  it("gives a resource route every header but the CSP", async () => {
    const { result } = await run(
      new Response("<urlset/>", { headers: { "Content-Type": "application/xml" } }),
    );

    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("Content-Type")).toBe("application/xml");
  });

  it("covers error pages and redirects, even with immutable headers", async () => {
    const error = await run(
      new Response("<p>404</p>", { status: 404, headers: { "Content-Type": "text/html" } }),
    );
    expect(error.result.status).toBe(404);
    expect(error.result.headers.get("Content-Security-Policy-Report-Only")).not.toBeNull();

    const redirect = await run(Response.redirect("http://localhost/en", 302));
    expect(redirect.result.status).toBe(302);
    expect(redirect.result.headers.get("Location")).toBe("http://localhost/en");
    expect(redirect.result.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
