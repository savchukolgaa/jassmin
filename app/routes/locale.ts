import { data, redirect } from "react-router";
import { z } from "zod";
import { localeCookie } from "~/.server/locale";
import { localizedUrl } from "~/.server/paths";
import { safeRedirect } from "~/lib/auth";
import { DEFAULT_LOCALE, LOCALES } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import type { Route } from "./+types/locale";

const localeFormSchema = z.object({
  locale: z.enum(LOCALES),
  redirectTo: z.string().optional(),
});

export type LocaleActionResult = { ok: false; error: "invalid-locale" };

// POST only, from the language switcher and the "View in English" hint: stores the choice and goes
// to the same page's URL in the chosen language (#84), keeping the query and hash. A plain form
// post, so it works without JS; with JS the redirect keeps the scroll position (#82).
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData().catch(() => new FormData());
  const parsed = localeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Only a tampered form gets here: the switcher only offers supported locales.
    return data<LocaleActionResult>({ ok: false, error: "invalid-locale" }, { status: 400 });
  }
  const { locale, redirectTo } = parsed.data;
  const target = await localizedUrl(safeRedirect(redirectTo, pathFor(locale, "home")), locale);
  return redirect(target, {
    headers: { "Set-Cookie": await localeCookie.serialize(locale) },
  });
}

export function loader() {
  return redirect(pathFor(DEFAULT_LOCALE, "home"));
}
