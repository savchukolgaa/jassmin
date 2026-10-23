import { formatPrice } from "../money";
import { en } from "./en";
import { DEFAULT_LOCALE, INTL_LOCALES, type Locale } from "./locales";
import type {
  Dictionary,
  MessageKey,
  MessageParams,
  PluralForms,
  PluralKey,
  TextKey,
} from "./types";
import { uk } from "./uk";

const DICTIONARIES: Record<Locale, Dictionary> = { uk, en };

export interface TranslateFunction {
  (key: PluralKey, params: MessageParams & { count: number }): string;
  (key: TextKey, params?: MessageParams): string;
}

/** Everything the UI needs to render text in one locale. */
export interface Translator {
  locale: Locale;
  t: TranslateFunction;
  /** A `numeric(10, 2)` price string in hryvnias, e.g. `6 850 ₴` / `₴6,850`. */
  formatPrice: (price: string) => string;
  /** An ISO timestamp as a long date in shop time, e.g. `22 жовтня 2026 р.`. */
  formatDate: (iso: string) => string;
  formatNumber: (value: number) => string;
}

/** Marks a zod or action error message as a message key; it is translated when rendered. */
export function msg(key: TextKey): TextKey {
  return key;
}

function lookup(dictionary: Dictionary, key: string): string | PluralForms | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "object" && node !== null && "other" in node) {
    return node as PluralForms;
  }
  return undefined;
}

/** Whether `value` is a plain (non-plural) message key, e.g. an error returned by an action. */
export function isTextKey(value: string): value is TextKey {
  return typeof lookup(uk, value) === "string";
}

const translators = new Map<Locale, Translator>();

/** The translator for `locale`, created once per locale. */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const cached = translators.get(locale);
  if (cached) {
    return cached;
  }

  const intlLocale = INTL_LOCALES[locale];
  const dictionary = DICTIONARIES[locale];
  const numbers = new Intl.NumberFormat(intlLocale);
  const plurals = new Intl.PluralRules(intlLocale);
  const dates = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "long",
    timeZone: "Europe/Kyiv",
  });
  const formatNumber = (value: number) => numbers.format(value);

  function t(key: MessageKey, params: MessageParams = {}): string {
    const message = lookup(dictionary, key);
    if (message === undefined) {
      // Unreachable for typed keys; shows the key instead of crashing the page.
      return key;
    }
    let template: string;
    if (typeof message === "string") {
      template = message;
    } else {
      const forms: Partial<Record<Intl.LDMLPluralRule, string>> = message;
      template = forms[plurals.select(Number(params.count))] ?? message.other;
    }
    // A missing param stays as `{name}` so it is noticed.
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined) return placeholder;
      return typeof value === "number" ? formatNumber(value) : value;
    });
  }

  const translator: Translator = {
    locale,
    t,
    formatPrice: (price) => formatPrice(price, locale),
    formatDate: (iso) => dates.format(new Date(iso)),
    formatNumber,
  };
  translators.set(locale, translator);
  return translator;
}
