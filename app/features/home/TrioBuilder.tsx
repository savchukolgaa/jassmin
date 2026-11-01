import { useEffect, useState } from "react";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { useT } from "~/lib/i18n";
import {
  labelTrioFamilies,
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
  trioOffer: TrioOffer | null;
};

/**
 * "Build your trio": pick up to three fragrance families, see them fill three slots, then go to
 * the popular perfumes with those families (#67). A GET form, so it works without JS (the
 * "Show my picks" button reloads the page with `?family=`); with JS the slots fill in place.
 * It never adds anything to the cart.
 */
export function TrioBuilder({ families, selected, trioOffer }: TrioBuilderProps) {
  const translator = useT();
  const { t, formatPrice } = translator;
  const [picked, setPicked] = useState(selected);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // A new no-JS submission (or back/forward) brings new picks from the loader.
  const selectedKey = selected.join("\n");
  useEffect(() => setPicked(selectedKey ? selectedKey.split("\n") : []), [selectedKey]);

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
            className="flex min-w-0 flex-[1_1_26rem] flex-col gap-5"
          >
            <h2
              id="trio-title"
              className="text-4xl leading-none font-bold tracking-[-0.01em] md:text-5xl"
            >
              {t("home.trio.title")}
            </h2>
            <p className="text-lg leading-relaxed text-on-dark-muted">{t("home.trio.intro")}</p>
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

          <div className="flex min-w-0 flex-[1_1_22rem] flex-col items-start gap-5">
            <ol aria-label={t("home.trio.slots")} className="flex gap-2 sm:gap-3">
              {Array.from({ length: TRIO_SIZE }, (_, index) => {
                const family = picked[index];
                const n = index + 1;
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: the slots are fixed positions.
                    key={index}
                    className="flex h-28 w-22 items-center justify-center rounded-[3.25rem_3.25rem_1rem_1rem] border-2 border-dashed border-muted sm:h-33 sm:w-26"
                  >
                    {family ? (
                      <span
                        // A new key replays the pop when the slot gets another family.
                        key={family}
                        className="animate-slot-pop flex h-25 w-19 items-end sm:h-30 sm:w-23 justify-center rounded-[2.875rem_2.875rem_0.75rem_0.75rem] bg-primary-light px-1 pb-3.5 text-center text-[0.8125rem] font-extrabold text-ink"
                      >
                        <span className="sr-only">{t("home.trio.slot", { n })}: </span>
                        {labels.get(family) ?? family}
                      </span>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="text-3xl font-extrabold text-on-dark-muted"
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
            {full ? (
              <ButtonLink
                to={trioHref(translator.locale, picked)}
                size="lg"
                className="animate-pop"
              >
                {trioOffer
                  ? t("home.trio.cta", { price: formatPrice(trioOffer.price) })
                  : t("home.trio.ctaNoPrice")}
              </ButtonLink>
            ) : (
              <p role="status" className="font-bold text-on-dark-muted">
                {t("home.trio.left", { count: TRIO_SIZE - picked.length })}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
