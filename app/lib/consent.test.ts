import { describe, expect, it } from "vitest";
import { consentFormSchema, isConsentValue } from "./consent";

describe("isConsentValue", () => {
  it("accepts only the stored choices", () => {
    expect(isConsentValue("granted")).toBe(true);
    expect(isConsentValue("denied")).toBe(true);
    expect(isConsentValue("reset")).toBe(false);
    expect(isConsentValue(undefined)).toBe(false);
  });
});

describe("consentFormSchema", () => {
  it("accepts the banner and footer choices", () => {
    for (const consent of ["granted", "denied", "reset"]) {
      expect(consentFormSchema.safeParse({ consent, redirectTo: "/blog" }).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(consentFormSchema.safeParse({ consent: "yes" }).success).toBe(false);
    expect(consentFormSchema.safeParse({}).success).toBe(false);
  });
});

describe("COOKIE_INVENTORY", () => {
  it("lists exactly the cookies the site sets", async () => {
    const { COOKIE_INVENTORY } = await import("./consent");
    const { SESSION_COOKIE_NAME } = await import("~/.server/session-cookie");
    const { localeCookie } = await import("~/.server/locale");
    const { consentCookie } = await import("~/.server/consent");
    const { ANALYTICS_SESSION_COOKIE, ANONYMOUS_ID_COOKIE } = await import(
      "~/.server/visitor-cookie"
    );

    expect(COOKIE_INVENTORY.map((cookie) => cookie.name).sort()).toEqual(
      [
        SESSION_COOKIE_NAME,
        localeCookie.name,
        consentCookie.name,
        ANONYMOUS_ID_COOKIE,
        ANALYTICS_SESSION_COOKIE,
      ].sort(),
    );
  });
});
