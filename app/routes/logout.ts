import { redirect } from "react-router";
import { z } from "zod";
import { logout } from "~/.server/session";
import { DEFAULT_LOCALE, LOCALES } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import type { Route } from "./+types/logout";

// The page's language, sent by the form: `/logout` itself has no locale prefix (#84).
const logoutFormSchema = z.object({ locale: z.enum(LOCALES).catch(DEFAULT_LOCALE) });

// POST only, from the "Log out" button: a GET (a link, a prefetch) must never log anyone out.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData().catch(() => new FormData());
  const { locale } = logoutFormSchema.parse(Object.fromEntries(formData));
  return logout(request, locale);
}

export function loader() {
  return redirect(pathFor(DEFAULT_LOCALE, "home"));
}
