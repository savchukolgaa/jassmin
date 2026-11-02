import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import type { CatalogGender } from "~/lib/catalog";
import { useT } from "~/lib/i18n";
import { POPULAR_GENDER_KEYS, popularHref } from "~/lib/popular";
import type { TrioFamily } from "~/lib/trio";

const chip = "chip-hover inline-flex min-h-11 items-center rounded-pill px-4 font-extrabold";

/**
 * The deep-pink band at the top of /popular: the eyebrow, the title and the intro, then the trio
 * builder's filter when the list is narrowed: the gender (#102) as a removable chip with a switch
 * to the other one, and the families as removable chips.
 */
export function PopularHero({
  families,
  gender,
}: {
  families: TrioFamily[];
  gender: CatalogGender | null;
}) {
  const { t, locale } = useT();
  const familyValues = families.map((family) => family.value);
  const otherGender: CatalogGender = gender === "women" ? "men" : "women";

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
        {(families.length > 0 || gender) && (
          <div className="flex animate-fade-up anim-delay-3 flex-wrap items-center gap-x-3 gap-y-2.5 pt-2">
            <span className="font-extrabold">{t("popular.yourTrio")}</span>
            {gender && (
              <ul aria-label={t("popular.gender.label")} className="flex flex-wrap gap-2">
                <li className="animate-pop">
                  <Link
                    to={popularHref(locale, { families: familyValues, gender: null })}
                    aria-label={t("popular.gender.remove", {
                      gender: t(POPULAR_GENDER_KEYS[gender]),
                    })}
                    className={`${chip} gap-2 bg-white text-primary-dark ${focusRing("onPrimary")}`}
                  >
                    {t(POPULAR_GENDER_KEYS[gender])}
                    <span aria-hidden="true" className="text-lg leading-none">
                      ×
                    </span>
                  </Link>
                </li>
                <li>
                  <Link
                    to={popularHref(locale, { families: familyValues, gender: otherGender })}
                    className={`${chip} border-2 border-white text-white ${focusRing("onPrimary")}`}
                  >
                    {t(POPULAR_GENDER_KEYS[otherGender])}
                  </Link>
                </li>
              </ul>
            )}
            {families.length > 0 && (
              <ul aria-label={t("popular.chosenFamilies")} className="flex flex-wrap gap-2">
                {families.map((family) => (
                  <li key={family.value} className="animate-pop">
                    <Link
                      to={popularHref(locale, {
                        families: familyValues.filter((other) => other !== family.value),
                        gender,
                      })}
                      aria-label={t("popular.removeFamily", { family: family.label })}
                      className={`${chip} gap-2 bg-white text-primary-dark ${focusRing("onPrimary")}`}
                    >
                      {family.label}
                      <span aria-hidden="true" className="text-lg leading-none">
                        ×
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to={popularHref(locale, { families: [], gender: null })}
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
