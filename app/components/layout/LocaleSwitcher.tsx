import { Form, useLocation } from "react-router";
import { cn } from "~/lib/cn";
import { LOCALE_LABELS, LOCALES, type Locale, useT } from "~/lib/i18n";
import { FlagGbIcon, FlagUaIcon } from "./icons";
import { focusRing, type NavTone } from "./nav";

const FLAGS: Record<Locale, typeof FlagUaIcon> = { uk: FlagUaIcon, en: FlagGbIcon };

/** One language option; the active one is inverted like the logged-in profile icon. */
export function localeButtonClasses(active: boolean, tone: NavTone = "onPrimary"): string {
  return cn(
    "inline-flex min-h-11 items-center gap-1.5 rounded-pill px-2.5 text-sm font-bold transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? active
        ? "bg-white text-primary"
        : "text-white hover:bg-primary-dark"
      : active
        ? "bg-blush text-primary-dark"
        : "text-ink hover:bg-blush hover:text-primary-dark",
  );
}

/**
 * Flag buttons for Ukrainian and English. A plain form post to `/locale`, which stores the choice
 * in a cookie and comes back to this page (hash included), so it works without JS. With JS the
 * redirect back keeps the scroll position, so only the text changes (#82).
 */
export function LocaleSwitcher({
  tone = "onPrimary",
  className,
}: {
  tone?: NavTone;
  className?: string;
}) {
  const { locale, t } = useT();
  const { pathname, search, hash } = useLocation();

  return (
    <Form method="post" action="/locale" preventScrollReset className={className}>
      <input type="hidden" name="redirectTo" value={pathname + search + hash} />
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">{t("locale.label")}</legend>
        {LOCALES.map((option) => {
          const Flag = FLAGS[option];
          const active = option === locale;
          return (
            <button
              key={option}
              type="submit"
              name="locale"
              value={option}
              lang={option}
              aria-pressed={active}
              className={localeButtonClasses(active, tone)}
            >
              <Flag className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10" />
              {LOCALE_LABELS[option]}
            </button>
          );
        })}
      </fieldset>
    </Form>
  );
}
