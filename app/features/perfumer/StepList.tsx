import { fragranceFamilyLabel } from "~/lib/catalog";
import { type Translator, useT } from "~/lib/i18n";
import type { PerfumerStep } from "~/lib/perfumer";
import { CheckIcon } from "./icons";

// What the perfumer did while answering (#164), one chip per catalog search: "Шукаю в каталозі:
// водяні, до 600 ₴ · знайдено 4 аромати". The step holds only catalog-safe values (resolved
// families, a catalog title), so the chips never repeat the model's own words.

/** A step as a sentence: what was searched for. */
export function stepText(step: PerfumerStep, translator: Translator): string {
  const { t, formatPrice, locale } = translator;
  if (step.tool === "similar") {
    return step.title
      ? t("perfumer.steps.similar", { title: step.title })
      : t("perfumer.steps.similarUnknown");
  }
  const criteria = [
    ...step.families.map((family) =>
      fragranceFamilyLabel(family, translator).toLocaleLowerCase(locale),
    ),
    ...(step.gender ? [t(`perfumer.steps.${step.gender}`)] : []),
    ...(step.maxPriceUah !== undefined
      ? [t("perfumer.steps.upTo", { price: formatPrice(String(step.maxPriceUah)) })]
      : []),
  ];
  return criteria.length
    ? t("perfumer.steps.searchFor", { criteria: criteria.join(", ") })
    : t("perfumer.steps.search");
}

/** What a step found: "знайдено 4 аромати", or "нічого не знайдено". */
export function foundText(step: PerfumerStep, { t }: Pick<Translator, "t">): string {
  return step.found > 0
    ? t("perfumer.steps.found", { count: step.found })
    : t("perfumer.steps.foundNone");
}

export function StepList({ steps }: { steps: readonly PerfumerStep[] }) {
  const translator = useT();
  return (
    <ul
      aria-label={translator.t("perfumer.steps.label")}
      className="flex flex-col items-start gap-2"
    >
      {steps.map((step, index) => (
        <li
          // Steps only ever get appended, so the index is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list
          key={index}
          className="inline-flex animate-pop items-start gap-2 rounded-pill bg-blush px-3.5 py-1.5 text-sm font-semibold text-ink"
        >
          <CheckIcon className="mt-0.5 size-4 flex-none text-primary-dark" />
          <span>
            {stepText(step, translator)}
            <span className="text-muted"> · {foundText(step, translator)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
