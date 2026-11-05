import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { action } = await import("./csp-report");
const { MAX_CSP_REPORT_BYTES, stripQuery } = await import("~/.server/csp-report");

type ActionArgs = Parameters<typeof action>[0];

let ip = 0;

/** A report from its own IP, so the rate limit doesn't carry over between tests. */
function post(
  body: string,
  { contentType = "application/csp-report", method = "POST", forwardedFor = `10.1.0.${++ip}` } = {},
) {
  const request = new Request("http://localhost/csp-report", {
    method,
    headers: { "Content-Type": contentType, "X-Forwarded-For": forwardedFor },
    ...(method === "POST" ? { body } : {}),
  });
  return action({ request, params: {}, context: {} } as unknown as ActionArgs);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const reportUriBody = JSON.stringify({
  "csp-report": {
    "document-uri": "https://jassmin.ua/vkhid?redirectTo=%2Fkabinet&email=a%40b.ua",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?token=secret",
    "source-file": "https://jassmin.ua/assets/app.js?v=1",
    "line-number": 12,
    disposition: "report",
  },
});

describe("CSP report endpoint", () => {
  it("logs a report-uri violation without query strings", async () => {
    const response = await post(reportUriBody);

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("[csp]", {
      directive: "script-src-elem",
      blockedUri: "https://evil.example/x.js",
      documentPath: "/vkhid",
      sourceFile: "https://jassmin.ua/assets/app.js",
      line: 12,
      disposition: "report",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("email");
  });

  it("logs every csp-violation of a Reporting API batch and skips other report types", async () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        age: 10,
        url: "https://jassmin.ua/",
        body: {
          documentURL: "https://jassmin.ua/koshyk",
          effectiveDirective: "img-src",
          blockedURL: "https://cdn.example/a.png",
          disposition: "enforce",
          lineNumber: null,
        },
      },
      { type: "deprecation", body: { id: "x" } },
    ]);

    const response = await post(body, { contentType: "application/reports+json" });

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[csp]", {
      directive: "img-src",
      blockedUri: "https://cdn.example/a.png",
      documentPath: "/koshyk",
      sourceFile: undefined,
      line: undefined,
      disposition: "enforce",
    });
  });

  it("refuses bodies over the size limit, invalid JSON and other methods", async () => {
    expect((await post("x".repeat(MAX_CSP_REPORT_BYTES + 1))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ other: 1 }))).status).toBe(400);
    expect((await post("", { method: "GET" })).status).toBe(405);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rate-limits a client", async () => {
    const forwardedFor = "10.2.0.1";
    for (let i = 0; i < 30; i++) {
      expect((await post(reportUriBody, { forwardedFor })).status).toBe(204);
    }

    expect((await post(reportUriBody, { forwardedFor })).status).toBe(429);
    expect((await post(reportUriBody)).status).toBe(204);
  });
});

describe("stripQuery", () => {
  it("keeps keywords and cuts queries and fragments", () => {
    expect(stripQuery("inline")).toBe("inline");
    expect(stripQuery("eval")).toBe("eval");
    expect(stripQuery("data:image/png;base64,AAAA")).toBe("data:");
    expect(stripQuery("https://a.example/p?q=1#f")).toBe("https://a.example/p");
    expect(stripQuery("/relative?q=1")).toBe("/relative");
  });
});
