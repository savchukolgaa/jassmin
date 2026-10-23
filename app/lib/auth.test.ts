import { describe, expect, it } from "vitest";
import {
  loginRedirectPath,
  loginSchema,
  registerSchema,
  resolveAcquisitionChannel,
  safeRedirect,
  toFieldErrors,
} from "./auth";

const validRegistration = {
  fullName: "  Olena Petrenko ",
  email: " Olena@Example.COM ",
  password: "correct horse",
  phone: "",
};

describe("registerSchema", () => {
  it("normalises a valid registration", () => {
    expect(registerSchema.parse(validRegistration)).toEqual({
      fullName: "Olena Petrenko",
      email: "olena@example.com",
      password: "correct horse",
      phone: undefined,
      acquisitionChannel: undefined,
      redirectTo: undefined,
    });
  });

  it("accepts a phone number and a channel", () => {
    const result = registerSchema.parse({
      ...validRegistration,
      phone: "+380 (67) 123-45-67",
      acquisitionChannel: "Instagram",
    });

    expect(result.phone).toBe("+380 (67) 123-45-67");
    expect(result.acquisitionChannel).toBe("instagram");
  });

  it("reports every invalid field", () => {
    const result = registerSchema.safeParse({
      fullName: " ",
      email: "not-an-email",
      password: "short",
      phone: "call me",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      toFieldErrors(result.error, ["fullName", "email", "password", "phone"] as const),
    ).toEqual({
      fullName: "auth.errors.nameRequired",
      email: "auth.errors.emailInvalid",
      password: "auth.errors.passwordTooShort",
      phone: "auth.errors.phoneInvalid",
    });
  });

  it("rejects passwords over 128 characters", () => {
    expect(
      registerSchema.safeParse({ ...validRegistration, password: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it("drops an unusable acquisition channel instead of failing", () => {
    const result = registerSchema.parse({
      ...validRegistration,
      acquisitionChannel: "x".repeat(101),
    });

    expect(result.acquisitionChannel).toBeUndefined();
  });
});

describe("loginSchema", () => {
  it("normalises the email and keeps redirectTo", () => {
    expect(
      loginSchema.parse({ email: "A@B.CO", password: "secret", redirectTo: "/account" }),
    ).toEqual({ email: "a@b.co", password: "secret", redirectTo: "/account" });
  });

  it("requires a password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("safeRedirect", () => {
  it.each(["/account", "/products/1?x=1#y", "/"])("allows the same-site path %s", (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "account", "", undefined, null, 42])(
    "falls back for %s",
    (value) => {
      expect(safeRedirect(value)).toBe("/account");
    },
  );

  it("uses the given fallback", () => {
    expect(safeRedirect(undefined, "/")).toBe("/");
  });
});

describe("loginRedirectPath", () => {
  it("encodes the current path and query", () => {
    expect(loginRedirectPath(new URL("http://localhost/account?tab=orders"))).toBe(
      "/login?redirectTo=%2Faccount%3Ftab%3Dorders",
    );
  });
});

describe("resolveAcquisitionChannel", () => {
  const url = (search = "") => new URL(`https://jassmin.ua/register${search}`);

  it("prefers utm_source", () => {
    expect(resolveAcquisitionChannel(url("?utm_source=Instagram"), "https://www.google.com/")).toBe(
      "instagram",
    );
  });

  it("uses an external referrer's host without www", () => {
    expect(resolveAcquisitionChannel(url(), "https://www.google.com/search?q=x")).toBe(
      "google.com",
    );
  });

  it("ignores the site's own pages as referrer", () => {
    expect(resolveAcquisitionChannel(url(), "https://jassmin.ua/catalog/women")).toBe("direct");
  });

  it("defaults to direct", () => {
    expect(resolveAcquisitionChannel(url(), null)).toBe("direct");
    expect(resolveAcquisitionChannel(url(), "not a url")).toBe("direct");
  });
});
