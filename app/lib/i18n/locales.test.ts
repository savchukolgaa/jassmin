import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "./locales";

describe("locales", () => {
  it("defaults to Ukrainian", () => {
    expect(DEFAULT_LOCALE).toBe("uk");
    expect(LOCALES).toEqual(["uk", "en"]);
  });

  it("accepts only supported locales", () => {
    expect(isLocale("uk")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
