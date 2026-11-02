import { describe, expect, it } from "vitest";
import { messagesFor } from "./dictionaries";
import { metaTranslator } from "./react";

describe("metaTranslator", () => {
  it("translates with the messages from the root loader's data (#96)", () => {
    const messages = messagesFor("en");
    const { t, locale } = metaTranslator([
      { id: "root", loaderData: { locale: "en", messages } },
      { id: "routes/_shop", loaderData: {} },
    ]);
    expect(locale).toBe("en");
    expect(t("nav.about")).toBe("About us");
  });

  it("falls back to the default locale without root data", () => {
    // Tests register a fallback with both dictionaries (`test-setup.ts`); in the app it shows keys.
    const { t, locale } = metaTranslator([]);
    expect(locale).toBe("uk");
    expect(t("nav.about")).toBe("Про нас");
  });
});
