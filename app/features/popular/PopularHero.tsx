import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { useT } from "~/lib/i18n";
import { popularHref } from "~/lib/popular";
import type { TrioFamily } from "~/lib/trio";

/**
 * The deep-pink band at the top of /popular: the eyebrow, the title and the intro, then the trio
 * builder's families as removable chips when the list is narrowed to them.
 */
export function PopularHero({ families }: { families: TrioFamily[] }) {
  const { t } = useT();

  return (
    <section aria-labelledby="popular-title" className="overflow-hidden bg-primary text-white">
      <div className="container mx-auto flex flex-col items-start gap-4 px-4 py-14 md:py-16">
        <p className="animate-fade-up text-sm font-extrabold tracking-widest uppercase">
          {t("popular.eyebrow")}
        </p>
        <h1
          id="popular-title"
          className="animate-fade-up anim-delay-1 text-5xl leading-none font-bold tracking-[-0.01em] text-balance md:text-7xl"
        >
          {t("popular.title")}
        </h1>
        <p className="max-w-2xl animate-fade-up anim-delay-2 text-xl">{t("popular.intro")}</p>
        {families.length > 0 && (
          <div className="flex animate-fade-up anim-delay-3 flex-wrap items-center gap-x-3 gap-y-2.5 pt-2">
            <span className="font-extrabold">{t("popular.yourTrio")}</span>
            <ul aria-label={t("popular.chosenFamilies")} className="flex flex-wrap gap-2">
              {families.map((family) => (
                <li key={family.value} className="animate-pop">
                  <Link
                    to={popularHref(
                      families.filter((other) => other !== family).map((other) => other.value),
                    )}
                    aria-label={t("popular.removeFamily", { family: family.label })}
                    className={`chip-hover inline-flex min-h-11 items-center gap-2 rounded-pill bg-white px-4 font-extrabold text-primary-dark ${focusRing("onPrimary")}`}
                  >
                    {family.label}
                    <span aria-hidden="true" className="text-lg leading-none">
                      ×
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              to={popularHref([])}
              className={`inline-flex min-h-11 items-center rounded px-2 font-extrabold text-white underline ${focusRing("onPrimary")}`}
            >
              {t("popular.showAll")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
