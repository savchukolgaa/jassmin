import type { ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import type { ButtonSize } from "~/components/ui/button-styles";
import { type CartActionResult, cartErrorMessage } from "~/lib/cart";
import { cn } from "~/lib/cn";
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
  /**
   * `icon`: a round "+" button that turns into "✓" once added (home bestsellers, #64); `label` is
   * then its accessible name, and the "Added to cart" status floats below it.
   */
  appearance?: "button" | "icon";
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
  appearance = "button",
  className,
  children,
}: AddToCartFormProps) {
  const translator = useT();
  const { t } = translator;
  const fetcher = useFetcher<CartActionResult>({ key: `add-to-cart-${productId}` });
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const icon = appearance === "icon";

  return (
    <fetcher.Form method="post" action="/cart" className={cn(icon && "relative", className)}>
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="productId" value={productId} />
      {variantId && <input type="hidden" name="variantId" value={variantId} />}
      {children}
      {icon ? (
        <QuickAddButton
          label={inStock ? (label ?? t("cart.add")) : t("product.outOfStock")}
          inStock={inStock}
          busy={fetcher.state !== "idle"}
          added={result?.ok === true}
        />
      ) : (
        <Button
          type="submit"
          size={size}
          className="w-full"
          disabled={!inStock}
          loading={fetcher.state !== "idle"}
        >
          {inStock ? (label ?? t("cart.add")) : t("product.outOfStock")}
        </Button>
      )}
      <div
        aria-live="polite"
        className={cn(
          "text-sm",
          icon ? "absolute top-full right-0 z-10 mt-2 w-max max-w-64" : "mt-2 min-h-5",
        )}
      >
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

/** The round "+" of a compact product card; a green "✓" once the product is in the cart. */
function QuickAddButton({
  label,
  inStock,
  busy,
  added,
}: {
  label: string;
  inStock: boolean;
  busy: boolean;
  added: boolean;
}) {
  const { t } = useT();
  return (
    <button
      type="submit"
      aria-label={added ? t("cart.added") : label}
      title={added ? t("cart.added") : label}
      disabled={!inStock || busy}
      aria-busy={busy || undefined}
      className={cn(
        "quick-add flex size-12 items-center justify-center rounded-full text-2xl font-extrabold text-white",
        "disabled:cursor-not-allowed disabled:opacity-60",
        focusRing("onLight"),
        added ? "bg-success" : "bg-primary not-disabled:hover:bg-primary-dark",
      )}
    >
      <span aria-hidden="true">{added ? "✓" : "+"}</span>
    </button>
  );
}
