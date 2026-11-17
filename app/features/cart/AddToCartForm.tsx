import { type FormEvent, type ReactNode, type Ref, useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import type { ButtonSize } from "~/components/ui/button-styles";
import type { ListContext } from "~/lib/analytics";
import { type CartActionResult, cartErrorMessage } from "~/lib/cart";
import { cn } from "~/lib/cn";
import { usePathFor, useT } from "~/lib/i18n";

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
  /** The product list the card is in, posted for the `add_to_cart` event (#129). */
  list?: ListContext;
  /**
   * The fetcher's key; `add-to-cart-<productId>` by default, so every form for a product shares
   * its "Added to cart" state. The AI perfumer's cards key it per answer (#169).
   */
  fetcherKey?: string;
  /**
   * Scrolls the "Added to cart" line (or the cart's error) into view when it appears, e.g. above
   * the AI perfumer's sticky message bar (#169); `statusClassName` gives that line the
   * `scroll-mb-*` that clears the bar.
   */
  revealResult?: boolean;
  statusClassName?: string;
  /** Fields rendered inside the form, before the button. */
  children?: ReactNode;
}

/**
 * Dispatched on `window` each time "Added to cart" appears, so fixed UI near it can move out of the
 * way (the AI perfumer corner button on phones, #165).
 */
export const CART_ADDED_EVENT = "jassmin:cart-added";

/** Posts `intent=add` to the cart action without navigating away. */
export function AddToCartForm({
  productId,
  variantId,
  inStock,
  label,
  size = "md",
  appearance = "button",
  className,
  list,
  fetcherKey,
  revealResult = false,
  statusClassName,
  children,
}: AddToCartFormProps) {
  const translator = useT();
  const path = usePathFor();
  const { t } = translator;
  const fetcher = useFetcher<CartActionResult>({
    key: fetcherKey ?? `add-to-cart-${productId}`,
  });
  const idle = fetcher.state === "idle";
  const result = idle ? fetcher.data : undefined;
  const icon = appearance === "icon";
  const buttonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  /** Whether the button had focus when the form was sent, so it gets it back (#169). */
  const refocus = useRef(false);

  useEffect(() => {
    if (result?.ok === true) window.dispatchEvent(new Event(CART_ADDED_EVENT));
  }, [result]);

  useEffect(() => {
    if (!revealResult || result == null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    statusRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [result, revealResult]);

  // The button is disabled while the form is sent, which drops its focus: give it back.
  useEffect(() => {
    if (!idle || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [idle]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const button = buttonRef.current;
    refocus.current = button !== null && event.currentTarget.ownerDocument.activeElement === button;
  }

  return (
    <fetcher.Form
      method="post"
      action={path("cart")}
      className={cn(icon && "relative", className)}
      onSubmit={onSubmit}
    >
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="productId" value={productId} />
      {variantId && <input type="hidden" name="variantId" value={variantId} />}
      {list && (
        <>
          <input type="hidden" name="listId" value={list.list_id} />
          <input type="hidden" name="listPosition" value={list.list_position} />
          {list.search_id && <input type="hidden" name="searchId" value={list.search_id} />}
        </>
      )}
      {children}
      {icon ? (
        <QuickAddButton
          buttonRef={buttonRef}
          label={inStock ? (label ?? t("cart.add")) : t("product.outOfStock")}
          inStock={inStock}
          busy={fetcher.state !== "idle"}
          added={result?.ok === true}
        />
      ) : (
        <Button
          ref={buttonRef}
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
        ref={statusRef}
        aria-live="polite"
        className={cn(
          "text-sm",
          icon ? "absolute top-full right-0 z-10 mt-2 w-max max-w-64" : "mt-2 min-h-5",
          statusClassName,
        )}
      >
        {result?.ok === true && (
          <p
            role="status"
            className="inline-flex animate-toast items-center gap-2 rounded-pill bg-success-bg px-3 py-1 font-bold text-success"
          >
            {t("cart.added")}
            <Link
              to={path("cart")}
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
  buttonRef,
  label,
  inStock,
  busy,
  added,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  label: string;
  inStock: boolean;
  busy: boolean;
  added: boolean;
}) {
  const { t } = useT();
  return (
    <button
      ref={buttonRef}
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
