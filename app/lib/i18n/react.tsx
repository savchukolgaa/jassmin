import { createContext, type ReactNode, useContext } from "react";
import { type PathBuilder, pathFor } from "../paths";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";
import { createTranslatorFrom, type Translator } from "./translator";
import type { Dictionary } from "./types";

/**
 * The translator for a locale whose messages weren't passed in. In the app that only happens when
 * the root loader failed, and every message then renders as its key. Tests register one that
 * loads both dictionaries (`./test-setup.ts`), so components render without a provider (in
 * Ukrainian) and with `<I18nProvider locale="en">`.
 */
let fallbackTranslator = (locale: Locale): Translator => createTranslatorFrom(locale, undefined);

/** Test setup only: see `fallbackTranslator`. */
export function setFallbackTranslator(create: (locale: Locale) => Translator): void {
  fallbackTranslator = create;
}

const I18nContext = createContext<Translator | null>(null);

/**
 * Gives every component below it the active locale's translator; set up in the root `Layout`
 * with the messages the root loader sent (#96).
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages?: Dictionary;
  children?: ReactNode;
}) {
  const translator = messages ? createTranslatorFrom(locale, messages) : fallbackTranslator(locale);
  return <I18nContext value={translator}>{children}</I18nContext>;
}

/** The active locale's `t()` and formatters. */
export function useT(): Translator {
  return useContext(I18nContext) ?? fallbackTranslator(DEFAULT_LOCALE);
}

/**
 * `pathFor` in the active locale (#84): every internal link and form action in a component is
 * built with it, e.g. `const path = usePathFor(); path("catalog", { gender: "women" })`.
 */
export function usePathFor(): PathBuilder {
  const { locale } = useT();
  return (page, ...args) => pathFor(locale, page, ...args);
}

/**
 * The `lang` attribute for CMS content served in `contentLocale`: set only when it differs from
 * the UI locale (Ukrainian content shown as a fallback under the English UI), so screen readers
 * switch voices, and absent otherwise so the markup stays the same.
 */
export function useContentLang(contentLocale: Locale): Locale | undefined {
  const { locale } = useT();
  return contentLocale === locale ? undefined : contentLocale;
}

/**
 * The translator for a route's `meta` function, which can't use hooks: the locale and its messages
 * come from the root loader's data in `matches`.
 */
export function metaTranslator(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined> | undefined,
): Translator {
  const root = matches?.find((match) => match?.id === "root")?.loaderData;
  if (typeof root !== "object" || root === null) {
    return fallbackTranslator(DEFAULT_LOCALE);
  }
  const locale = "locale" in root && isLocale(root.locale) ? root.locale : DEFAULT_LOCALE;
  const messages = "messages" in root ? (root.messages as Dictionary | undefined) : undefined;
  return messages ? createTranslatorFrom(locale, messages) : fallbackTranslator(locale);
}
