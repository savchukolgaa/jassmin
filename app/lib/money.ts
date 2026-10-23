import { DEFAULT_LOCALE, INTL_LOCALES, type Locale } from "./i18n/locales";

const formatters = new Map<Locale, Intl.NumberFormat>();

function uahFormat(locale: Locale): Intl.NumberFormat {
  let format = formatters.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(INTL_LOCALES[locale], {
      style: "currency",
      currency: "UAH",
      // `₴` in every locale, not `UAH`.
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    formatters.set(locale, format);
  }
  return format;
}

/**
 * Formats a `numeric(10, 2)` price string (e.g. `"6850.00"`) in hryvnias for display, e.g.
 * `6 850 ₴` in Ukrainian or `₴6,850` in English. Display only: never do arithmetic on the result
 * or on the parsed number.
 */
export function formatPrice(price: string, locale: Locale = DEFAULT_LOCALE): string {
  return uahFormat(locale).format(Number(price));
}
