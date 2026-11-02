import { describe, expect, it } from "vitest";
import { loginRedirectPath, resolveAcquisitionChannel, safeRedirect } from "./auth";
import {
  changeEmailSchema,
  changePasswordSchema,
  contactSchema,
  loginSchema,
  profileIntentSchema,
  registerSchema,
  toFieldErrors,
} from "./auth.schema";

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
  it.each(["/account", "/products/1?x=1#y", "/", "/#location-title"])(
    "allows the same-site path %s",
    (path) => {
      expect(safeRedirect(path, "/kabinet")).toBe(path);
    },
  );

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "account", "", undefined, null, 42])(
    "falls back for %s",
    (value) => {
      expect(safeRedirect(value, "/kabinet")).toBe("/kabinet");
    },
  );

  it("uses the given fallback", () => {
    expect(safeRedirect(undefined, "/")).toBe("/");
  });
});

describe("loginRedirectPath", () => {
  it("encodes the current path and query", () => {
    expect(loginRedirectPath(new URL("http://localhost/account?tab=orders"))).toBe(
      "/vkhid?redirectTo=%2Faccount%3Ftab%3Dorders",
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

describe("profile schemas", () => {
  it("trims the contact details and turns a blank phone into undefined", () => {
    expect(contactSchema.parse({ fullName: "  Olena Petrenko ", phone: "  " })).toEqual({
      fullName: "Olena Petrenko",
      phone: undefined,
    });
  });

  it("rejects a bad phone and a blank name with the register rules", () => {
    const result = contactSchema.safeParse({ fullName: " ", phone: "call me" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error, ["fullName", "phone"])).toEqual({
      fullName: "auth.errors.nameRequired",
      phone: "auth.errors.phoneInvalid",
    });
  });

  it("normalises the new email and needs the current password", () => {
    expect(
      changeEmailSchema.parse({ email: " New@Example.COM ", currentPassword: "secret" }),
    ).toEqual({ email: "new@example.com", currentPassword: "secret" });

    const result = changeEmailSchema.safeParse({ email: "a@example.com", currentPassword: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error, ["email", "currentPassword"])).toEqual({
      currentPassword: "account.profile.errors.currentPasswordRequired",
    });
  });

  it("checks the new password's length and its confirmation", () => {
    const valid = {
      currentPassword: "old secret",
      newPassword: "correct horse",
      confirmNewPassword: "correct horse",
    };
    expect(changePasswordSchema.parse(valid)).toEqual(valid);

    const short = changePasswordSchema.safeParse({
      ...valid,
      newPassword: "short",
      confirmNewPassword: "short",
    });
    expect(short.success).toBe(false);
    if (short.success) return;
    expect(toFieldErrors(short.error, ["newPassword"])).toEqual({
      newPassword: "auth.errors.passwordTooShort",
    });

    const mismatch = changePasswordSchema.safeParse({ ...valid, confirmNewPassword: "other" });
    expect(mismatch.success).toBe(false);
    if (mismatch.success) return;
    expect(toFieldErrors(mismatch.error, ["newPassword", "confirmNewPassword"])).toEqual({
      confirmNewPassword: "account.profile.errors.passwordMismatch",
    });
  });

  it("only accepts the three intents", () => {
    expect(profileIntentSchema.safeParse("password").success).toBe(true);
    expect(profileIntentSchema.safeParse("delete").success).toBe(false);
  });
});
