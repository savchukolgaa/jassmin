import { createContext, type ReactNode, useContext } from "react";
import { isLocale, type Locale } from "./locales";
import { createTranslator, type Translator } from "./translator";

// Without a provider (e.g. in component tests) components render in the default locale.
const I18nContext = createContext<Translator>(createTranslator());

/** Gives every component below it the active locale's translator; set up in the root `Layout`. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext value={createTranslator(locale)}>{children}</I18nContext>;
}

/** The active locale's `t()` and formatters. */
export function useT(): Translator {
  return useContext(I18nContext);
}

/**
 * The translator for a route's `meta` function, which can't use hooks: the locale comes from the
 * root loader's data in `matches`.
 */
export function metaTranslator(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): Translator {
  const root = matches.find((match) => match?.id === "root")?.loaderData;
  const locale =
    typeof root === "object" && root !== null && "locale" in root ? root.locale : undefined;
  return createTranslator(isLocale(locale) ? locale : undefined);
}
