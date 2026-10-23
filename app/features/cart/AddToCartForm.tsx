import type { ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import type { ButtonSize } from "~/components/ui/button-styles";
import { type CartActionResult, cartErrorMessage } from "~/lib/cart";
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
  const translator = useT();
  const { t } = translator;
  const fetcher = useFetcher<CartActionResult>({ key: `add-to-cart-${productId}` });
  const result = fetcher.state === "idle" ? fetcher.data : undefined;

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
      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {result?.ok === true && (
          <p
            role="status"
            className="inline-flex animate-toast items-center gap-2 rounded-pill bg-success-bg px-3 py-1 font-bold text-success"
          >
            {t("cart.added")}
            <Link
              to="/cart"
              className={`rounded underline underline-offset-2 ${focusRing("onLight")}`}
            >
              {t("cart.view")}
            </Link>
          </p>
        )}
        {result?.ok === false && (
          <p className="text-muted">{cartErrorMessage(result, translator)}</p>
        )}
      </div>
    </fetcher.Form>
  );
}
