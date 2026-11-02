// Both locales' messages (#28), for code that may load all of them: the server, tests and the
// zod schema modules (`isTextKey`). Not re-exported from `~/lib/i18n`, so the browser bundle never
// includes them: it gets the active locale's messages from the root loader instead (#96).
// `client-bundle.guard.test.ts` keeps it that way.
import { en } from "./en";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { createTranslatorFrom, lookup, type Translator } from "./translator";
import type { Dictionary, TextKey } from "./types";
import { uk } from "./uk";

const DICTIONARIES: Record<Locale, Dictionary> = { uk, en };

/** Every message in `locale`, as the root loader sends it to the browser. */
export function messagesFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** The translator for `locale`, created once per locale. */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  return createTranslatorFrom(locale, DICTIONARIES[locale]);
}

/** Whether `value` is a plain (non-plural) message key, e.g. an error returned by an action. */
export function isTextKey(value: string): value is TextKey {
  return typeof lookup(uk, value) === "string";
}
