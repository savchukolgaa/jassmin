// The translator itself, without any dictionary: the browser gets only the active locale's
// messages, from the root loader (#96). Server code, tests and `isTextKey` take both dictionaries
// from `./dictionaries`.
import { formatPrice } from "../money";
import { INTL_LOCALES, type Locale } from "./locales";
import type {
  Dictionary,
  MessageKey,
  MessageParams,
  PluralForms,
  PluralKey,
  TextKey,
} from "./types";

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

/** The message at a dotted `key`, or `undefined` when there is none. */
export function lookup(
  dictionary: Dictionary | undefined,
  key: string,
): string | PluralForms | undefined {
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

const translators = new WeakMap<Dictionary, Translator>();

/**
 * The translator for `locale` with that locale's `messages`, created once per dictionary.
 * Without messages (only when the root loader failed) every message renders as its key.
 */
export function createTranslatorFrom(locale: Locale, messages: Dictionary | undefined): Translator {
  const cached = messages && translators.get(messages);
  if (cached) {
    return cached;
  }

  const intlLocale = INTL_LOCALES[locale];
  const numbers = new Intl.NumberFormat(intlLocale);
  const plurals = new Intl.PluralRules(intlLocale);
  const dates = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "long",
    timeZone: "Europe/Kyiv",
  });
  const formatNumber = (value: number) => numbers.format(value);

  function t(key: MessageKey, params: MessageParams = {}): string {
    const message = lookup(messages, key);
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
  if (messages) {
    translators.set(messages, translator);
  }
  return translator;
}
