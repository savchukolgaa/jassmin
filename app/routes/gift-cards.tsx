import { data, redirect } from "react-router";
import { getLocale } from "~/.server/locale";
import { getUser } from "~/.server/services/auth";
import { createGiftCard } from "~/.server/services/gift-cards";
import { isCardPaymentAvailable, startGiftCardPayment } from "~/.server/services/payments";
import { rememberGiftCard } from "~/.server/session";
import { GiftCardPurchaseForm } from "~/features/gift-cards/GiftCardPurchaseForm";
import type { AuthFormErrors } from "~/lib/auth";
import { toFieldErrors } from "~/lib/auth.schema";
import { GIFT_CARD_VALIDITY_MONTHS } from "~/lib/gift-cards";
import { GIFT_CARD_PURCHASE_FIELDS, parseGiftCardPurchase } from "~/lib/gift-cards.schema";
import { metaTranslator, useT } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/gift-cards";

type GiftCardPurchaseField = (typeof GIFT_CARD_PURCHASE_FIELDS)[number];

type GiftCardPurchaseErrors = AuthFormErrors<GiftCardPurchaseField>;

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("giftCards.metaTitle") }),
      description: t("giftCards.metaDescription"),
    },
  );
}

// The gift card page (#125), linked from the offers page (#126): three amounts, paid by card only.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  return { cardPaymentAvailable: isCardPaymentAvailable(), prefillEmail: user?.email ?? null };
}

/** The submitted values, to refill the form after an error. */
function purchaseValues(formData: FormData): Partial<Record<GiftCardPurchaseField, string>> {
  const values: Partial<Record<GiftCardPurchaseField, string>> = {};
  for (const field of GIFT_CARD_PURCHASE_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value;
  }
  return values;
}

// Creates a pending card and sends the buyer to the provider's page. The card is only usable,
// and its code only sent, once the provider's callback says the payment succeeded.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const values = purchaseValues(formData);
  const parsed = parseGiftCardPurchase(formData);
  if (!parsed.success) {
    return data<GiftCardPurchaseErrors>(
      { fieldErrors: toFieldErrors(parsed.error, GIFT_CARD_PURCHASE_FIELDS), values },
      { status: 400 },
    );
  }
  // Gift cards are sold for card payment only: there's no cash on delivery here.
  if (!isCardPaymentAvailable()) {
    return data<GiftCardPurchaseErrors>(
      { formError: "giftCards.unavailable", values },
      { status: 400 },
    );
  }

  const [user, locale] = await Promise.all([getUser(request), getLocale(request)]);
  const giftCardId = await createGiftCard({
    amount: parsed.data.amount,
    email: parsed.data.email,
    recipientEmail: parsed.data.recipientEmail,
    userId: user?.id ?? null,
    locale,
  });
  const headers = { "Set-Cookie": await rememberGiftCard(request, giftCardId) };
  const payment = await startGiftCardPayment({
    giftCardId,
    locale,
    origin: new URL(request.url).origin,
  }).catch((error: unknown) => {
    console.error(`Could not start the payment for gift card ${giftCardId}`, error);
    return null;
  });
  if (payment?.ok) {
    return redirect(payment.redirectUrl, { headers });
  }
  // The card is created either way: its page offers to pay again.
  return redirect(pathFor(locale, "giftCardSuccess", { giftCardId: String(giftCardId) }), {
    headers,
  });
}

export default function GiftCards({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();

  return (
    <main>
      <section aria-labelledby="gift-cards-title" className="bg-primary text-white">
        <div className="container mx-auto px-4 py-14 md:py-20">
          <p className="animate-fade-up font-sans text-sm font-bold tracking-widest uppercase">
            {t("giftCards.eyebrow")}
          </p>
          <h1
            id="gift-cards-title"
            className="mt-4 animate-fade-up anim-delay-1 text-5xl leading-none font-bold tracking-[-0.01em] text-balance md:text-7xl"
          >
            {t("giftCards.heading")}
          </h1>
          <p className="mt-5 max-w-2xl animate-fade-up anim-delay-2 text-xl">
            {t("giftCards.intro")}
          </p>
        </div>
      </section>
      <div className="container mx-auto grid gap-10 px-4 pt-12 pb-16 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start">
        <section aria-labelledby="gift-cards-steps" className="flex flex-col gap-5">
          <h2 id="gift-cards-steps" className="text-3xl font-bold tracking-[-0.01em] text-ink">
            {t("giftCards.steps.heading")}
          </h2>
          <ol className="flex flex-col gap-4">
            {(["buy", "email", "use"] as const).map((step, index) => (
              <li key={step} className="flex gap-4 rounded-card bg-blush p-5">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white"
                >
                  {index + 1}
                </span>
                <p className="text-lg text-body">{t(`giftCards.steps.${step}`)}</p>
              </li>
            ))}
          </ol>
          <p className="text-muted">
            {t("giftCards.validity", { months: GIFT_CARD_VALIDITY_MONTHS })}
          </p>
        </section>
        <GiftCardPurchaseForm
          prefillEmail={loaderData.prefillEmail}
          cardAvailable={loaderData.cardPaymentAvailable}
          fieldErrors={actionData?.fieldErrors}
          formError={actionData?.formError}
          values={actionData?.values}
        />
      </div>
    </main>
  );
}
