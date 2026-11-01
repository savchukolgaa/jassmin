import { useId } from "react";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { type CardVariant, formatVolume } from "~/lib/products";

export interface CardVolumePickerProps {
  /** Ascending by volume; the card only renders the picker for two or more. */
  variants: CardVariant[];
  packSize: number;
  /** The size checked at first (the product's `defaultVariant`). */
  defaultId: string;
  onChange: (variantId: string) => void;
  className?: string;
}

/**
 * The size pills on a product card (#74): radios named `variantId`, so the card's add-to-cart form
 * posts the picked size without JS too. Each form is its own radio group, so the name is the same
 * on every card; the ids are unique. Uncontrolled, so a size picked before hydration stays picked.
 * Sold-out sizes are shown struck through but can't be picked.
 */
export function CardVolumePicker({
  variants,
  packSize,
  defaultId,
  onChange,
  className,
}: CardVolumePickerProps) {
  const translator = useT();
  const { t } = translator;
  const id = useId();

  return (
    <fieldset className={className}>
      <legend className="sr-only">{t("product.volumeLegend")}</legend>
      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => (
          <label key={variant.id} htmlFor={`${id}-${variant.id}`} className="relative">
            <input
              type="radio"
              id={`${id}-${variant.id}`}
              name="variantId"
              value={variant.id}
              defaultChecked={variant.id === defaultId}
              disabled={!variant.inStock}
              onChange={(event) => onChange(event.currentTarget.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-pill border-2 border-line px-3.5 text-sm font-extrabold text-ink",
                variant.inStock && "chip-hover",
                "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white",
                "peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
                "peer-disabled:cursor-not-allowed peer-disabled:text-muted peer-disabled:line-through peer-disabled:opacity-60",
              )}
            >
              {formatVolume({ volumeMl: variant.volumeMl, packSize }, translator)}
              {!variant.inStock && <span className="sr-only">, {t("product.outOfStockSize")}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
