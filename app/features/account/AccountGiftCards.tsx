import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";
import type { GiftCardStatus } from "~/lib/enums";
import { formatGiftCardCode, GIFT_CARD_STATUS_KEYS, type GiftCardView } from "~/lib/gift-cards";
import { usePathFor, useT } from "~/lib/i18n";

/** Pill colours from the theme tokens: usable cards green, unpaid pink, the rest neutral. */
function pillTone(status: GiftCardStatus): string {
  if (status === "active") return "bg-success-bg text-success";
  if (status === "pending") return "bg-primary text-white";
  return "bg-card text-body";
}

/**
 * The gift cards the user bought (#125), newest first: amount, balance, expiry, recipient and,
 * once paid, the code (the user is the buyer). An unpaid card links to its page to pay.
 */
export function AccountGiftCards({ cards }: { cards: GiftCardView[] }) {
  const { t, formatPrice, formatDate } = useT();
  const path = usePathFor();

  return (
    <section aria-labelledby="account-gift-cards-heading" className="flex flex-col gap-4">
      <h2
        id="account-gift-cards-heading"
        className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl"
      >
        {t("account.giftCards.heading")}
      </h2>
      <ul className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <li
            key={card.id}
            className="flex flex-col gap-3 rounded-card-lg border border-line bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-serif text-2xl font-bold text-ink">
                {t("account.giftCards.amount", { amount: formatPrice(card.initialAmount) })}
              </p>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-pill px-4 py-1.5 text-sm font-extrabold",
                  pillTone(card.status),
                )}
              >
                {t(GIFT_CARD_STATUS_KEYS[card.status])}
              </span>
            </div>
            {card.code && (
              <p className="flex flex-col gap-0.5">
                <span className="text-sm font-extrabold text-muted">
                  {t("account.giftCards.code")}
                </span>
                <span className="font-mono text-lg font-bold tracking-wider break-all text-ink">
                  {formatGiftCardCode(card.code)}
                </span>
              </p>
            )}
            {card.status !== "pending" && (
              <p className="font-bold text-ink">
                {t("account.giftCards.balance", { amount: formatPrice(card.balance) })}
              </p>
            )}
            {card.expiresAt && (
              <p className="text-sm text-muted">
                {t("account.giftCards.expires", { date: formatDate(card.expiresAt.toISOString()) })}
              </p>
            )}
            {card.recipientEmail && (
              <p className="text-sm text-muted">
                {t("account.giftCards.recipient", { email: card.recipientEmail })}
              </p>
            )}
            {card.status === "pending" && (
              <Link
                to={path("giftCardSuccess", { giftCardId: String(card.id) })}
                className={cn(
                  "self-start rounded font-bold text-primary-dark underline",
                  focusRing("onLight"),
                )}
              >
                {t("account.giftCards.pay")}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Link
        to={path("giftCards")}
        className={cn(
          "self-start rounded font-bold text-primary-dark underline",
          focusRing("onLight"),
        )}
      >
        {t("account.giftCards.buy")}
      </Link>
    </section>
  );
}
