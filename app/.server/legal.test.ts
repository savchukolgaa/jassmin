import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteSettings } from "~/lib/cms";
import type { Locale } from "~/lib/i18n";
import { getSellerDetails, resetSellerCheckForTests, warnIfSellerDetailsMissing } from "./legal";

const settings: SiteSettings = {
  locale: "uk",
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
  customerServiceHours: null,
  legalName: "Іваненко Марія Петрівна",
  taxId: "1234567890",
  legalAddress: "м. Київ, вул. Хрещатик, 1",
  registrationNote: "Запис в ЄДР від 01.03.2024",
  socialLinks: [],
};

afterEach(() => {
  resetSellerCheckForTests();
});

describe("getSellerDetails", () => {
  it("keeps the locale's own address and note", async () => {
    const load = vi.fn(async (locale: Locale) => ({
      ...settings,
      locale,
      legalAddress: "Kyiv, 1 Khreshchatyk St.",
    }));

    expect(await getSellerDetails("en", { load })).toMatchObject({
      legalAddress: "Kyiv, 1 Khreshchatyk St.",
      email: "hello@jassmin.ua",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ignores a failing Ukrainian fallback", async () => {
    const load = vi.fn(async (locale: Locale) => {
      if (locale === "uk") throw new Error("Strapi down");
      return { ...settings, locale, legalAddress: null };
    });

    expect((await getSellerDetails("en", { load })).legalAddress).toBeNull();
  });
});

describe("warnIfSellerDetailsMissing", () => {
  const production = { NODE_ENV: "production" };

  it("warns in production about the empty required details, once", async () => {
    const warn = vi.fn();
    const load = vi.fn(async () => ({ ...settings, taxId: null, legalAddress: " " }));

    await warnIfSellerDetailsMissing({ env: production, load, warn });
    await warnIfSellerDetailsMissing({ env: production, load, warn });

    expect(load).toHaveBeenCalledWith("uk");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "[legal] Seller details missing in the Strapi site settings: taxId, legalAddress.",
    );
  });

  it("stays quiet when every required detail is filled", async () => {
    const warn = vi.fn();
    await warnIfSellerDetailsMissing({
      env: production,
      load: async () => ({ ...settings, registrationNote: null }),
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't check outside production", async () => {
    const warn = vi.fn();
    const load = vi.fn(async () => settings);
    await warnIfSellerDetailsMissing({ env: { NODE_ENV: "development" }, load, warn });
    expect(load).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("says when Strapi couldn't be reached, without throwing", async () => {
    const warn = vi.fn();
    await expect(
      warnIfSellerDetailsMissing({
        env: production,
        load: async () => {
          throw new Error("connect ECONNREFUSED");
        },
        warn,
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[legal] Couldn't check the seller's details"),
    );
  });
});
