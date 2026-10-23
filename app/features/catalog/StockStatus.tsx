import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { LOW_STOCK_THRESHOLD } from "~/lib/products";

export interface StockStatusProps {
  inStock: boolean;
  /** When known, low stock shows "Залишилося лише N" / "Only N left". */
  stockQuantity?: number;
  className?: string;
}

export function StockStatus({ inStock, stockQuantity, className }: StockStatusProps) {
  const { t } = useT();
  const low = inStock && stockQuantity !== undefined && stockQuantity <= LOW_STOCK_THRESHOLD;
  const label = !inStock
    ? t("product.outOfStock")
    : low
      ? t("product.onlyLeft", { count: stockQuantity ?? 0 })
      : t("product.inStock");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-3 py-1 text-sm font-bold",
        inStock ? "bg-success-bg text-success" : "bg-card text-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}
