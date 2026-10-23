import type { ReactNode } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import type { ButtonSize } from "~/components/ui/button-styles";
import { CART_ERROR_KEYS, type CartActionResult } from "~/lib/cart";
import { useT } from "~/lib/i18n";

export interface AddToCartFormProps {
  /** The product's public id. */
  productId: string;
  /** The chosen variant's public id, sent as a hidden field. Omit it when `children` render a
   * `variantId` field (the product page's volume select). */
  variantId?: string;
  inStock: boolean;
  /** The button text when in stock; "Додати в кошик" / "Add to cart" by default. */
  label?: string;
  size?: ButtonSize;
  className?: string;
  /** Fields rendered inside the form, before the button. */
  children?: ReactNode;
}

/** Posts `intent=add` to the cart action without navigating away. */
export function AddToCartForm({
  productId,
  variantId,
  inStock,
  label,
  size = "md",
  className,
  children,
}: AddToCartFormProps) {
  const { t } = useT();
  const fetcher = useFetcher<CartActionResult>({ key: `add-to-cart-${productId}` });
  const error = fetcher.state === "idle" && fetcher.data?.ok === false ? fetcher.data.error : null;

  return (
    <fetcher.Form method="post" action="/cart" className={className}>
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="productId" value={productId} />
      {variantId && <input type="hidden" name="variantId" value={variantId} />}
      {children}
      <Button
        type="submit"
        size={size}
        className="w-full"
        disabled={!inStock}
        loading={fetcher.state !== "idle"}
      >
        {inStock ? (label ?? t("cart.add")) : t("product.outOfStock")}
      </Button>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">
        {error ? t(CART_ERROR_KEYS[error]) : null}
      </p>
    </fetcher.Form>
  );
}
