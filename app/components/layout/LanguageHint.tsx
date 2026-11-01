import { Form, useLocation } from "react-router";
import { cn } from "~/lib/cn";
import { I18nProvider, useT } from "~/lib/i18n";
import { CloseIcon } from "./icons";
import { focusRing } from "./nav";

/**
 * "View in English" (#84): shown on Ukrainian pages to a first-time visitor whose browser prefers
 * English, instead of redirecting them, so crawlers still reach both versions. Both buttons post
 * to `/locale` like the switcher: English stores the choice and opens the page's English URL,
 * dismissing stores Ukrainian, so the bar doesn't come back. In English, for whom it's meant.
 */
export function LanguageHint() {
  return (
    <I18nProvider locale="en">
      <LanguageHintBar />
    </I18nProvider>
  );
}

function LanguageHintBar() {
  const { t } = useT();
  const { pathname, search, hash } = useLocation();

  return (
    <Form method="post" action="/locale" preventScrollReset lang="en">
      <input type="hidden" name="redirectTo" value={pathname + search + hash} />
      <section aria-label={t("locale.hint.label")} className="bg-blush text-ink">
        <div className="container mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
          <p>{t("locale.hint.message")}</p>
          <button
            type="submit"
            name="locale"
            value="en"
            className={cn(
              "min-h-11 rounded-pill font-extrabold text-primary-dark underline underline-offset-2",
              focusRing("onLight"),
            )}
          >
            {t("locale.hint.view")}
          </button>
          <button
            type="submit"
            name="locale"
            value="uk"
            aria-label={t("locale.hint.dismiss")}
            className={cn(
              "ml-auto inline-flex size-11 items-center justify-center rounded-full hover:bg-white",
              focusRing("onLight"),
            )}
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
      </section>
    </Form>
  );
}
