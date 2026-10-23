import { selectClasses } from "~/features/catalog/CatalogFilters";
import { formatVariantOption, type ProductVariant } from "~/lib/products";

export interface VolumeSelectProps {
  variants: ProductVariant[];
  packSize: number;
  /** The selected variant's public id. */
  value: string;
  onChange: (variantId: string) => void;
}

/**
 * The volume dropdown on the product page. A regular `variantId` form field, so the add-to-cart
 * form sends the chosen size without JS too. Sold-out sizes are listed but can't be chosen.
 */
export function VolumeSelect({ variants, packSize, value, onChange }: VolumeSelectProps) {
  return (
    <label className="grid gap-1 text-sm font-bold text-ink">
      Volume
      <select
        name="variantId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClasses}
      >
        {variants.map((variant) => (
          <option key={variant.id} value={variant.id} disabled={!variant.inStock}>
            {formatVariantOption(variant, packSize)}
          </option>
        ))}
      </select>
    </label>
  );
}
