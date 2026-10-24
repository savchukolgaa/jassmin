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
