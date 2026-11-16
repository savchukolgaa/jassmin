import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { CART_ADDED_EVENT } from "~/features/cart/AddToCartForm";
import { cn } from "~/lib/cn";
import { usePathFor, useT } from "~/lib/i18n";
import { pageOf } from "~/lib/paths";
import { showPerfumerCorner } from "~/lib/perfumer";
import { BottleIcon } from "./icons";

/** How long the button stays raised on phones after "Added to cart", as on the canvas. */
export const CART_ADDED_RAISE_MS = 2600;

/**
 * The floating "Запитати AI парфумера" link in the bottom-right corner (#165), as drawn on the C+
 * canvas (PerfumerCornerPlus artboards): a pink pill with a white round bottle from `sm`, a 60px
 * pink circle with only the bottle on phones (the label stays its accessible name). A plain link to
 * the chat, so it works without JS. The `_shop` layout renders it only while the perfumer is
 * enabled; it hides itself on the chat, cart, checkout and payment pages, and (CSS only) while the
 * mobile menu is open. Its height above the bottom is in `.perfumer-corner` (`app/app.css`).
 */
export function PerfumerCornerButton({ cookieBanner = false }: { cookieBanner?: boolean }) {
  const { t } = useT();
  const path = usePathFor();
  const { pathname } = useLocation();
  const raised = useRaisedAfterCartAdd();

  if (!showPerfumerCorner(pageOf(pathname))) return null;

  return (
    <Link
      to={path("perfumer")}
      data-cookie-banner={cookieBanner || undefined}
      data-raised={raised || undefined}
      className={cn(
        "perfumer-corner fixed right-4 z-30 flex items-center justify-center rounded-pill",
        "size-15 bg-primary text-white shadow-[0_14px_30px_rgb(194_47_75/0.35)] hover:bg-primary-dark",
        "sm:right-6 sm:size-auto sm:min-h-14 sm:gap-2.5 sm:pr-5.5 sm:pl-2",
        "motion-safe:hover:scale-[1.03] motion-safe:animate-pop motion-safe:[animation-delay:600ms]",
        "max-lg:[body:has(details[data-mobile-menu][open])_&]:hidden",
        focusRing("onLight"),
      )}
    >
      <span
        aria-hidden="true"
        className="flex flex-none items-center justify-center sm:size-10 sm:rounded-full sm:bg-white sm:text-primary"
      >
        <BottleIcon sparkle className="size-6" />
      </span>
      <span className="sr-only font-extrabold sm:not-sr-only">{t("perfumer.entry.corner")}</span>
    </Link>
  );
}

/**
 * True for `CART_ADDED_RAISE_MS` after "Added to cart" appears (`CART_ADDED_EVENT`), so on phones
 * the button doesn't cover the status under the product's add button.
 */
function useRaisedAfterCartAdd(): boolean {
  const [raised, setRaised] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function onAdded() {
      setRaised(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setRaised(false), CART_ADDED_RAISE_MS);
    }
    window.addEventListener(CART_ADDED_EVENT, onAdded);
    return () => {
      window.removeEventListener(CART_ADDED_EVENT, onAdded);
      clearTimeout(timer.current);
    };
  }, []);

  return raised;
}
