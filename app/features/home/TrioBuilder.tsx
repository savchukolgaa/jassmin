import { useEffect, useState } from "react";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import type { CatalogGender } from "~/lib/catalog";
import { useT } from "~/lib/i18n";
import {
  labelTrioFamilies,
  TRIO_GENDER_KEYS,
  TRIO_GENDERS,
  TRIO_SIZE,
  type TrioOffer,
  toggleTrioFamily,
  trioHref,
} from "~/lib/trio";

type TrioBuilderProps = {
  /** Stored family values; the chips show them in the UI's language. */
  families: string[];
  /** Families picked in the URL, from a submission without JS. */
  selected: string[];
  /** The Women / Men switch's choice from the URL (#102); women by default. */
  gender: CatalogGender;
  trioOffer: TrioOffer | null;
};

/**
 * "Build your trio": choose women or men (#102), pick up to three fragrance families, see them
 * fill three slots, then go to the popular perfumes of that gender with those families (#67). A
 * GET form, so it works without JS (the "Show my picks" button reloads the page with `?gender=`
 * and `?family=`); with JS the slots fill and the link updates in place.
 * It never adds anything to the cart.
 */
export function TrioBuilder({ families, selected, gender, trioOffer }: TrioBuilderProps) {
  const translator = useT();
  const { t, formatPrice } = translator;
  const [picked, setPicked] = useState(selected);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // A new no-JS submission (or back/forward) brings new picks from the loader.
  const selectedKey = selected.join("\n");
  useEffect(() => setPicked(selectedKey ? selectedKey.split("\n") : []), [selectedKey]);
  const [chosenGender, setChosenGender] = useState(gender);
  useEffect(() => setChosenGender(gender), [gender]);

  if (families.length === 0) {
    return null;
  }

  const options = labelTrioFamilies(families, translator);
  const labels = new Map(options.map((family) => [family.value, family.label]));
  const full = picked.length >= TRIO_SIZE;
  const toggle = (value: string, checked: boolean) =>
    setPicked((current) => toggleTrioFamily(current, value, checked));

  return (
    <section id="trio" aria-labelledby="trio-title" className="reveal scroll-mt-20">
      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-wrap items-center gap-10 rounded-[2.5rem] bg-ink p-6 text-white sm:p-12">
          <form
            method="get"
            action="/#trio"
            className="flex min-w-0 flex-[1_1_24rem] flex-col gap-5"
          >
            <h2
              id="trio-title"
              className="text-4xl leading-none font-bold tracking-[-0.01em] md:text-5xl"
            >
              {t("home.trio.title")}
            </h2>
            <p className="text-lg leading-relaxed text-on-dark-muted">{t("home.trio.intro")}</p>
            <fieldset>
              <legend className="sr-only">{t("home.trio.gender.legend")}</legend>
              {/* Native radios: one tab stop, and the arrow keys move between the options. */}
              <div className="inline-flex rounded-pill border-2 border-primary-light p-1">
                {TRIO_GENDERS.map((value) => (
                  <label key={value} className="relative">
                    <input
                      type="radio"
                      name="gender"
                      value={value}
                      checked={chosenGender === value}
                      onChange={() => setChosenGender(value)}
                      className="peer sr-only"
                    />
                    <span className="inline-flex min-h-11 cursor-pointer items-center rounded-pill px-5 text-[0.9375rem] font-extrabold transition-colors peer-checked:bg-primary-light peer-checked:text-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-light">
                      {t(TRIO_GENDER_KEYS[value])}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="sr-only">{t("home.trio.families")}</legend>
              <div className="flex flex-wrap gap-2.5">
                {options.map((family) => {
                  const checked = picked.includes(family.value);
                  return (
                    <label key={family.value} className="relative">
                      <input
                        type="checkbox"
                        name="family"
                        value={family.value}
                        checked={checked}
                        // Without JS the server caps the picks instead, so nothing is locked.
                        disabled={hydrated && full && !checked}
                        onChange={(event) => toggle(family.value, event.currentTarget.checked)}
                        className="peer sr-only"
                      />
                      <span className="chip-hover inline-flex min-h-11.5 cursor-pointer items-center rounded-pill border-2 border-primary-light px-5 text-[0.9375rem] font-extrabold peer-checked:bg-primary-light peer-checked:text-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-light peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                        {family.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {!hydrated && (
              <Button type="submit" variant="outline-light" size="sm" className="self-start">
                {t("home.trio.update")}
              </Button>
            )}
          </form>

          {/* Sized for a 360 px phone: 3 slots + gaps fill the card's 280 px content width. */}
          <div className="flex min-w-0 flex-[1_1_29rem] flex-col items-center">
            <div className="flex w-full flex-col gap-5 sm:w-fit">
              <ol
                aria-label={t("home.trio.slots")}
                className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:gap-3 md:gap-4"
              >
                {Array.from({ length: TRIO_SIZE }, (_, index) => {
                  const family = picked[index];
                  const n = index + 1;
                  return (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: the slots are fixed positions.
                      key={index}
                      // Per-breakpoint radii, not `rounded-t-full`: an oversized top radius makes
                      // the browser shrink every corner, which would flatten the bottom ones.
                      className="flex h-32 items-center justify-center rounded-[3.25rem_3.25rem_1rem_1rem] border-2 border-dashed border-muted sm:h-38 sm:w-28 sm:rounded-[3.5rem_3.5rem_1rem_1rem] md:h-48 md:w-36 md:rounded-[4.5rem_4.5rem_1.25rem_1.25rem]"
                    >
                      {family ? (
                        <span
                          // A new key replays the pop when the slot gets another family.
                          key={family}
                          className="animate-slot-pop flex h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)] items-end justify-center rounded-[2.875rem_2.875rem_0.75rem_0.75rem] bg-primary-light px-1.5 pb-4 text-center text-sm leading-tight font-extrabold text-balance hyphens-auto text-ink [overflow-wrap:anywhere] sm:rounded-[3.125rem_3.125rem_0.75rem_0.75rem] sm:text-[0.9375rem] md:rounded-[4.125rem_4.125rem_1rem_1rem] md:pb-6 md:text-base"
                        >
                          <span className="sr-only">{t("home.trio.slot", { n })}: </span>
                          {labels.get(family) ?? family}
                        </span>
                      ) : (
                        <>
                          <span
                            aria-hidden="true"
                            className="text-4xl font-extrabold text-on-dark-muted md:text-5xl"
                          >
                            {n}
                          </span>
                          <span className="sr-only">{t("home.trio.slot", { n })}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
              {/* As tall as the `xl` button, so nothing jumps when it replaces the status. */}
              <div className="flex min-h-16 items-center">
                {full ? (
                  <ButtonLink
                    to={trioHref(translator.locale, picked, chosenGender)}
                    size="xl"
                    className="animate-pop w-full"
                  >
                    {trioOffer
                      ? t("home.trio.cta", { price: formatPrice(trioOffer.price) })
                      : t("home.trio.ctaNoPrice")}
                  </ButtonLink>
                ) : (
                  <p role="status" className="text-lg font-bold text-on-dark-muted">
                    {t("home.trio.left", { count: TRIO_SIZE - picked.length })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
