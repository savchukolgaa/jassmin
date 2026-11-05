import { Form, Link, useNavigation } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { cn } from "~/lib/cn";
import {
  formatGiftCardCode,
  GIFT_CARD_STATUS_KEYS,
  type GiftCardPaymentView,
  type GiftCardView,
} from "~/lib/gift-cards";
import { usePathFor, useT } from "~/lib/i18n";

export interface GiftCardStatusProps {
  card: GiftCardView;
  payment: GiftCardPaymentView;
}

/**
 * A bought gift card's result page (#125): once paid, its code, amount, balance and expiry; while
 * unpaid, where the payment stands with a "Pay" / "Try again" button (a POST to this page).
 */
export function GiftCardStatus({ card, payment }: GiftCardStatusProps) {
  const { t, formatPrice, formatDate } = useT();
  const path = usePathFor();
  const here = path("giftCardSuccess", { giftCardId: String(card.id) });
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle" && navigation.formAction === here;

  if (payment !== "paid" || card.code === null) {
    const failed = payment === "failed";
    return (
      <section
        aria-labelledby="gift-card-status-heading"
        className={cn(
          "flex flex-col gap-4 rounded-card-lg p-8 md:p-12",
          failed ? "bg-blush" : "bg-card",
        )}
      >
        <h1
          id="gift-card-status-heading"
          className="text-4xl leading-tight font-bold tracking-[-0.01em] text-ink md:text-5xl"
        >
          {t(failed ? "giftCards.success.failedHeading" : "giftCards.success.pendingHeading")}
        </h1>
        <p role="status" className="text-lg text-body">
          {t(failed ? "giftCards.success.failedText" : "giftCards.success.pendingText")}
        </p>
        <p className="font-bold text-ink">
          {t("giftCards.success.amount")}: {formatPrice(card.initialAmount)}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Form method="post">
            <Button type="submit" loading={submitting}>
              {t(failed ? "giftCards.success.retry" : "giftCards.success.pay")}
            </Button>
          </Form>
          {!failed && (
            <Link to={here} className={cn("rounded font-bold underline", focusRing("onLight"))}>
              {t("giftCards.success.refresh")}
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="gift-card-status-heading"
      className="flex flex-col gap-6 rounded-card-lg bg-blush p-8 md:p-12"
    >
      <div className="flex flex-col gap-2">
        <h1
          id="gift-card-status-heading"
          className="text-4xl leading-tight font-bold tracking-[-0.01em] text-ink md:text-5xl"
        >
          {t("giftCards.success.paidHeading")}
        </h1>
        <p role="status" className="text-lg text-body">
          {card.recipientEmail
            ? t("giftCards.success.paidTextRecipient", {
                email: card.buyerEmail,
                recipient: card.recipientEmail,
              })
            : t("giftCards.success.paidText", { email: card.buyerEmail })}
        </p>
      </div>
      <dl className="grid gap-4 rounded-card bg-white p-6 ring-1 ring-line sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <dt className="text-sm font-extrabold text-muted">{t("giftCards.success.code")}</dt>
          <dd className="font-mono text-2xl font-bold tracking-wider break-all text-ink md:text-3xl">
            {formatGiftCardCode(card.code)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-extrabold text-muted">{t("giftCards.success.amount")}</dt>
          <dd className="font-bold text-ink">{formatPrice(card.initialAmount)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-extrabold text-muted">{t("giftCards.success.balance")}</dt>
          <dd className="font-bold text-ink">
            {formatPrice(card.balance)} · {t(GIFT_CARD_STATUS_KEYS[card.status])}
          </dd>
        </div>
      </dl>
      {card.expiresAt && (
        <p className="text-body">
          {t("giftCards.success.expiresOn", { date: formatDate(card.expiresAt.toISOString()) })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <ButtonLink to={path("catalog", { gender: "women" })}>
          {t("giftCards.success.continue")}
        </ButtonLink>
        <ButtonLink to={path("giftCards")} variant="dark">
          {t("giftCards.success.buyAnother")}
        </ButtonLink>
      </div>
    </section>
  );
}
