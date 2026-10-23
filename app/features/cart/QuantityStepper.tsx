import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";

export interface QuantityStepperProps {
  quantity: number;
  /** The highest allowed quantity (the stock); `+` is disabled at it. */
  max: number;
  /** What is counted, for the button labels, e.g. "Coco Mademoiselle, 50 мл". */
  label: string;
}

const stepButton = cn(
  "inline-flex size-11 items-center justify-center rounded-pill text-xl font-extrabold text-ink",
  "transition-colors hover:bg-blush disabled:cursor-not-allowed disabled:opacity-40",
  "disabled:hover:bg-transparent",
  focusRing("onLight"),
);

/**
 * Pill `−` / quantity / `+` control. Its buttons are submit buttons posting `quantity`, so it
 * goes inside the line's update form and works without JS.
 */
export function QuantityStepper({ quantity, max, label }: QuantityStepperProps) {
  const { t } = useT();
  // Above stock (it dropped since), `−` goes straight down to what's left.
  const lower = Math.min(quantity - 1, max);

  return (
    <div className="inline-flex items-center rounded-pill bg-card ring-1 ring-line">
      <button
        type="submit"
        name="quantity"
        value={lower}
        disabled={lower < 1}
        aria-label={t("cart.decrease", { item: label })}
        className={stepButton}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite" className="min-w-8 text-center text-base font-extrabold text-ink">
        <span className="sr-only">{t("cart.quantity")}</span>
        {quantity}
      </output>
      <button
        type="submit"
        name="quantity"
        value={quantity + 1}
        disabled={quantity >= max}
        aria-label={t("cart.increase", { item: label })}
        className={stepButton}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
