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

/**
 * An exact `numeric(10, 2)` string (e.g. `"999.5"`, `"1000.00"`) as whole kopiyky, for exact
 * arithmetic on money without floats. Throws on anything else (negative amounts included).
 */
export function toKopiyky(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) {
    throw new Error(`Not a money amount: ${amount}`);
  }
  return Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Whole kopiyky (non-negative) as a `numeric(10, 2)` string, e.g. `99950` → `"999.50"`. */
export function fromKopiyky(kopiyky: number): string {
  if (!Number.isSafeInteger(kopiyky) || kopiyky < 0) {
    throw new Error(`Not a kopiyky amount: ${kopiyky}`);
  }
  return `${Math.floor(kopiyky / 100)}.${String(kopiyky % 100).padStart(2, "0")}`;
}
