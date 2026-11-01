import { createCookie } from "react-router";
import { isLocale, type Locale } from "~/lib/i18n";
import { localeFromPath } from "~/lib/paths";

// Doesn't read the env, like `session-cookie.ts`, so any loader or test can resolve the locale.

/** The visitor's chosen language, set by the switcher (`routes/locale.ts`). Not sensitive. */
export const localeCookie = createCookie("locale", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: import.meta.env.PROD,
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * The best supported locale in an `Accept-Language` header (`uk-UA,uk;q=0.9,en;q=0.8`), by
 * weight. Matches on the primary subtag, so `en-US` counts as `en`.
 */
export function parseAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) {
    return undefined;
  }
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        language: tag.trim().toLowerCase().split("-")[0],
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.map(({ language }) => language).find(isLocale);
}

/**
 * The page's locale, from its URL alone (#84): `/en/…` is English, everything else Ukrainian. The
 * cookie and `Accept-Language` never change it; they only redirect (`locale-middleware.ts`) or
 * suggest the other language (`shouldSuggestEnglish`). Async, as when it read the cookie.
 */
export async function getLocale(request: Request): Promise<Locale> {
  return localeFromPath(new URL(request.url).pathname);
}

/** The language the visitor explicitly chose with the switcher, if any. */
export async function getChosenLocale(request: Request): Promise<Locale | undefined> {
  const cookie: unknown = await localeCookie.parse(request.headers.get("Cookie"));
  return isLocale(cookie) ? cookie : undefined;
}

/**
 * Whether to offer "View in English": a Ukrainian page, a visitor who never chose a language, and
 * a browser that prefers English. Never a redirect, so crawlers reach both versions.
 */
export async function shouldSuggestEnglish(request: Request): Promise<boolean> {
  if ((await getLocale(request)) !== "uk" || (await getChosenLocale(request)) !== undefined) {
    return false;
  }
  return parseAcceptLanguage(request.headers.get("Accept-Language")) === "en";
}
