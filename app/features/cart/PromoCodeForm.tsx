import { useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { type CartActionResult, cartErrorMessage } from "~/lib/cart";
import { cn } from "~/lib/cn";
import { type CartPromo, MAX_PROMO_CODE_LENGTH, PROMO_STATUS_KEYS } from "~/lib/discounts";
import { useT } from "~/lib/i18n";

/** Shared by the apply and remove forms, so the summary can tell when the code is saving. */
export const PROMO_FETCHER_KEY = "cart-promo";

/**
 * The cart's promo code (#59): a field to apply one, or the applied code with what it does and a
 * remove button. Posts to the cart action with a fetcher, or as a plain form without JS.
 */
export function PromoCodeForm({ promo }: { promo: CartPromo | null }) {
  const translator = useT();
  const { t } = translator;
  const fetcher = useFetcher<CartActionResult>({ key: PROMO_FETCHER_KEY });
  const busy = fetcher.state !== "idle";
  const error =
    !busy && fetcher.data?.ok === false ? cartErrorMessage(fetcher.data, translator) : undefined;

  if (promo) {
    return (
      <fetcher.Form method="post" action="/cart" className="flex flex-col gap-2">
        <input type="hidden" name="intent" value="remove-promo" />
        <p
          aria-live="polite"
          className={cn(
            "text-sm font-bold",
            promo.status === "applied" ? "text-success" : "text-primary-dark",
          )}
        >
          {t(PROMO_STATUS_KEYS[promo.status], { code: promo.code })}
        </p>
        <button
          type="submit"
          disabled={busy}
          className={cn(
            "self-start rounded text-sm font-bold text-primary-dark underline disabled:opacity-50",
            focusRing("onLight"),
          )}
        >
          {t("cart.promo.remove", { code: promo.code })}
        </button>
      </fetcher.Form>
    );
  }

  return (
    <fetcher.Form method="post" action="/cart" className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="apply-promo" />
      <TextField
        name="code"
        id="cart-promo-code"
        label={t("cart.promo.label")}
        error={error}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={MAX_PROMO_CODE_LENGTH}
        className="uppercase"
      />
      <Button type="submit" variant="dark" loading={busy} className="w-full">
        {t("cart.promo.apply")}
      </Button>
    </fetcher.Form>
  );
}
