import { useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { cn } from "~/lib/cn";
import {
  CHECKOUT_GIFT_CARD_FETCHER,
  type CheckoutGiftCard,
  type CheckoutGiftCardResult,
  MAX_GIFT_CARD_CODE_INPUT,
} from "~/lib/gift-cards";
import { usePathFor, useT } from "~/lib/i18n";

/**
 * The checkout's gift card (#125): a field to apply a code, or the applied card with what it pays
 * and a remove button. Posts to the checkout action with a fetcher (the page shows the result
 * without reloading), or as a plain form without JS.
 */
export function GiftCardField({ giftCard }: { giftCard: CheckoutGiftCard | null }) {
  const { t, formatPrice } = useT();
  const path = usePathFor();
  const fetcher = useFetcher<CheckoutGiftCardResult>({ key: CHECKOUT_GIFT_CARD_FETCHER });
  const busy = fetcher.state !== "idle";
  const error = !busy && fetcher.data?.ok === false ? t(fetcher.data.error) : undefined;

  return (
    <section
      aria-labelledby="gift-card-heading"
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <h3 id="gift-card-heading" className="text-lg font-extrabold text-ink">
        {t("checkout.giftCard.heading")}
      </h3>
      {giftCard ? (
        <fetcher.Form method="post" action={path("checkout")} className="flex flex-col gap-2">
          <input type="hidden" name="intent" value="remove-gift-card" />
          <p aria-live="polite" className="text-sm font-bold text-success">
            {t("checkout.giftCard.applied", { code: giftCard.maskedCode })}
          </p>
          <p className="text-sm text-muted">
            {t("checkout.giftCard.balanceAfter", { amount: formatPrice(giftCard.balanceAfter) })}
          </p>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "self-start rounded text-sm font-bold text-primary-dark underline disabled:opacity-50",
              focusRing("onLight"),
            )}
          >
            {t("checkout.giftCard.remove")}
          </button>
        </fetcher.Form>
      ) : (
        <fetcher.Form method="post" action={path("checkout")} className="flex flex-col gap-2">
          <input type="hidden" name="intent" value="apply-gift-card" />
          <TextField
            name="code"
            id="checkout-gift-card-code"
            label={t("checkout.giftCard.label")}
            error={error}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={MAX_GIFT_CARD_CODE_INPUT}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="uppercase"
          />
          <Button type="submit" variant="dark" loading={busy} className="w-full">
            {t("checkout.giftCard.apply")}
          </Button>
        </fetcher.Form>
      )}
    </section>
  );
}
