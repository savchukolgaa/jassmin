import { cn } from "~/lib/cn";
import { LOW_STOCK_THRESHOLD } from "~/lib/products";

export interface StockStatusProps {
  inStock: boolean;
  /** When known, low stock shows "Only N left". */
  stockQuantity?: number;
  className?: string;
}

export function StockStatus({ inStock, stockQuantity, className }: StockStatusProps) {
  const low = inStock && stockQuantity !== undefined && stockQuantity <= LOW_STOCK_THRESHOLD;
  const label = !inStock ? "Out of stock" : low ? `Only ${stockQuantity} left` : "In stock";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold",
        inStock ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-700",
        className,
      )}
    >
      {label}
    </span>
  );
}
