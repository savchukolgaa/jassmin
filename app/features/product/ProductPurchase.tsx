import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import { StockStatus } from "~/features/catalog/StockStatus";
import { useT } from "~/lib/i18n";
import { defaultVariant, type ProductDetail } from "~/lib/products";
import { VolumeSelect } from "./VolumeSelect";

/** Price, stock and add to cart for the size chosen in the volume dropdown. */
export function ProductPurchase({ product }: { product: ProductDetail }) {
  const { t, formatPrice } = useT();
  const [selectedId, setSelectedId] = useState(() => defaultVariant(product.variants)?.id);
  const selected = product.variants.find((v) => v.id === selectedId);

  if (!selected) {
    return (
      <>
        <StockStatus inStock={false} className="self-start" />
        <Button size="lg" className="w-full max-w-sm" disabled>
          {t("product.unavailable")}
        </Button>
      </>
    );
  }

  return (
    <>
      <p aria-live="polite" className="font-serif text-3xl font-bold text-ink">
        {/* Re-keyed so the price animates in again when the size changes. */}
        <span key={selected.id} className="inline-block animate-spin-in">
          {formatPrice(selected.price)}
        </span>
      </p>
      <StockStatus
        inStock={selected.inStock}
        // A size that doesn't track stock (#98) never runs low, so it only says "In stock".
        stockQuantity={selected.trackStock ? selected.stockQuantity : undefined}
        className="self-start"
      />
      <AddToCartForm
        productId={product.id}
        inStock={selected.inStock}
        size="lg"
        className="flex max-w-sm flex-col gap-3"
      >
        <VolumeSelect
          variants={product.variants}
          packSize={product.packSize}
          value={selected.id}
          onChange={setSelectedId}
        />
      </AddToCartForm>
    </>
  );
}
