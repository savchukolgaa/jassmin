import { describe, expect, it } from "vitest";
import { clearConsent, getConsent, serializeConsent } from "./consent";

function request(cookie?: string): Request {
  return new Request("http://localhost/", { headers: cookie ? { Cookie: cookie } : {} });
}

describe("consent cookie", () => {
  it("is unanswered without a cookie", async () => {
    expect(await getConsent(request())).toBeNull();
  });

  it("reads back what was stored", async () => {
    for (const consent of ["granted", "denied"] as const) {
      const setCookie = await serializeConsent(consent);
      expect(setCookie).toMatch(/^cookie_consent=/);
      expect(setCookie).toMatch(/Max-Age=31536000/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect(await getConsent(request(setCookie.split(";")[0]))).toBe(consent);
    }
  });

  it("ignores values it didn't write", async () => {
    expect(await getConsent(request("cookie_consent=yes"))).toBeNull();
  });

  it("is cleared with an expired cookie", async () => {
    const setCookie = await clearConsent();
    expect(setCookie).toMatch(/^cookie_consent=/);
    expect(setCookie).toMatch(/Max-Age=0/);
  });
});
