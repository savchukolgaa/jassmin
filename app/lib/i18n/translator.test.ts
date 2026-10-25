import { describe, expect, it } from "vitest";
import { createTranslator, isTextKey, msg } from "./translator";

// ICU separates thousands and the currency sign with (narrow) no-break spaces.
const normalize = (text: string) => text.replace(/\s/gu, " ");

const uk = createTranslator("uk");
const en = createTranslator("en");

describe("t", () => {
  it("looks up nested keys in the active locale", () => {
    expect(uk.t("nav.about")).toBe("Про нас");
    expect(en.t("nav.about")).toBe("About us");
  });

  it("fills placeholders and formats number params for the locale", () => {
    expect(en.t("account.greeting", { name: "Olena" })).toBe("Hi, Olena");
    expect(normalize(uk.t("contact.errors.messageTooLong", { messageMax: 2000 }))).toBe(
      "Повідомлення може містити щонайбільше 2 000 символів.",
    );
    expect(en.t("contact.errors.messageTooLong", { messageMax: 2000 })).toBe(
      "Your message can be at most 2,000 characters.",
    );
  });

  it("leaves a missing param visible and ignores unused ones", () => {
    expect(en.t("account.greeting")).toBe("Hi, {name}");
    expect(en.t("contact.errors.nameTooLong", { nameMax: 100, messageMax: 2000 })).toBe(
      "Your name can be at most 100 characters.",
    );
  });

  it("uses the Ukrainian plural forms", () => {
    const count = (n: number) => uk.t("catalog.count", { count: n });
    expect(count(1)).toBe("1 парфум");
    expect(count(2)).toBe("2 парфуми");
    expect(count(4)).toBe("4 парфуми");
    expect(count(5)).toBe("5 парфумів");
    expect(count(11)).toBe("11 парфумів");
    expect(count(21)).toBe("21 парфум");
    expect(count(22)).toBe("22 парфуми");
    expect(count(25)).toBe("25 парфумів");
    expect(count(0)).toBe("0 парфумів");
  });

  it("uses the English plural forms", () => {
    expect(en.t("catalog.count", { count: 1 })).toBe("1 perfume");
    expect(en.t("catalog.count", { count: 2 })).toBe("2 perfumes");
    expect(en.t("catalog.count", { count: 0 })).toBe("0 perfumes");
  });
});

describe("formatters", () => {
  it("formats prices in hryvnias for the locale", () => {
    expect(normalize(uk.formatPrice("6850.00"))).toBe("6 850 ₴");
    expect(en.formatPrice("6850.00")).toBe("₴6,850");
  });

  it("formats dates in shop time for the locale", () => {
    // 22:30 UTC is already the next day in Kyiv.
    expect(normalize(uk.formatDate("2026-10-21T22:30:00.000Z"))).toBe("22 жовтня 2026 р.");
    expect(en.formatDate("2026-10-21T22:30:00.000Z")).toBe("22 October 2026");
  });
});

describe("message keys", () => {
  it("recognises plain message keys only", () => {
    expect(isTextKey(msg("auth.errors.emailInvalid"))).toBe(true);
    expect(isTextKey("auth.errors")).toBe(false);
    expect(isTextKey("catalog.count")).toBe(false);
    expect(isTextKey("Enter a valid email address")).toBe(false);
    expect(isTextKey("toString")).toBe(false);
  });

  it("returns the same translator for a locale", () => {
    expect(createTranslator("en")).toBe(en);
    expect(createTranslator()).toBe(uk);
  });
});
