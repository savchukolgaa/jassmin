import { data, redirect } from "react-router";
import { z } from "zod";
import { localeCookie } from "~/.server/locale";
import { safeRedirect } from "~/lib/auth";
import { LOCALES } from "~/lib/i18n";
import type { Route } from "./+types/locale";

const localeFormSchema = z.object({
  locale: z.enum(LOCALES),
  redirectTo: z.string().optional(),
});

export type LocaleActionResult = { ok: false; error: "invalid-locale" };

// POST only, from the language switcher: stores the choice and goes back to the same page. A
// plain form post, so it works without JS; with JS every loader revalidates in the new locale.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData().catch(() => new FormData());
  const parsed = localeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Only a tampered form gets here: the switcher only offers supported locales.
    return data<LocaleActionResult>({ ok: false, error: "invalid-locale" }, { status: 400 });
  }
  const { locale, redirectTo } = parsed.data;
  return redirect(safeRedirect(redirectTo, "/"), {
    headers: { "Set-Cookie": await localeCookie.serialize(locale) },
  });
}

export function loader() {
  return redirect("/");
}
