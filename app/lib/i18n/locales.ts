// The languages the site is available in. Isomorphic: the server resolves the visitor's locale
// (`app/.server/locale.ts`) and the UI renders with it.

export const LOCALES = ["uk", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** The shop serves customers in Ukraine, so Ukrainian is the default. */
export const DEFAULT_LOCALE: Locale = "uk";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The BCP 47 tags `Intl` formats with: day-month dates in both languages. */
export const INTL_LOCALES: Record<Locale, string> = { uk: "uk-UA", en: "en-GB" };

/** The language switcher's labels, the same in every locale. */
export const LOCALE_LABELS: Record<Locale, string> = { uk: "УКР", en: "EN" };
