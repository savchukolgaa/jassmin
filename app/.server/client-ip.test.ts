import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFromHeader, getClientIp, warnIfNoTrustedProxy } from "./client-ip";

describe("clientIpFromHeader", () => {
  it("ignores X-Forwarded-For with 0 trusted hops, so it can't be spoofed", () => {
    expect(clientIpFromHeader("203.0.113.7", 0)).toBeUndefined();
  });

  it("takes the entry the last trusted proxy added with 1 hop", () => {
    expect(clientIpFromHeader("203.0.113.7", 1)).toBe("203.0.113.7");
    // The client sent its own header; the proxy appended the real address.
    expect(clientIpFromHeader("1.2.3.4, 203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("skips the proxies' own entries with 2 hops", () => {
    expect(clientIpFromHeader(" 6.6.6.6 , 203.0.113.7 , 10.0.0.1 ", 2)).toBe("203.0.113.7");
    expect(clientIpFromHeader("2001:db8::1, 10.0.0.1", 2)).toBe("2001:db8::1");
  });

  it("never gives a spoofing client a new key, whatever it puts on the left", () => {
    const spoofed = ["9.9.9.9, 203.0.113.7", "8.8.8.8, 7.7.7.7, 203.0.113.7", "203.0.113.7"];
    expect(new Set(spoofed.map((header) => clientIpFromHeader(header, 1)))).toEqual(
      new Set(["203.0.113.7"]),
    );
  });

  it("returns undefined for too few entries, a non-IP entry or no header", () => {
    expect(clientIpFromHeader("203.0.113.7", 2)).toBeUndefined();
    expect(clientIpFromHeader("1.2.3.4, unknown", 1)).toBeUndefined();
    expect(clientIpFromHeader("1.2.3.4, ", 1)).toBeUndefined();
    expect(clientIpFromHeader(null, 1)).toBeUndefined();
  });
});

describe("getClientIp", () => {
  it("reads the request's X-Forwarded-For", () => {
    const request = new Request("http://localhost/", {
      headers: { "X-Forwarded-For": "1.2.3.4, 203.0.113.7" },
    });

    expect(getClientIp(request, 1)).toBe("203.0.113.7");
    expect(getClientIp(request, 0)).toBeUndefined();
    expect(getClientIp(new Request("http://localhost/"), 1)).toBeUndefined();
  });
});

describe("warnIfNoTrustedProxy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns once in production without trusted hops, and never elsewhere", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfNoTrustedProxy({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: 0 });
    warnIfNoTrustedProxy({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: 1 });
    expect(warn).not.toHaveBeenCalled();

    warnIfNoTrustedProxy({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: 0 });
    warnIfNoTrustedProxy({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("TRUSTED_PROXY_HOPS");
  });
});
