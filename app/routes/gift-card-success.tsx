import { data, redirect } from "react-router";
import { getLocale } from "~/.server/locale";
import { getUser } from "~/.server/services/auth";
import { getGiftCardView } from "~/.server/services/gift-cards";
import { getGiftCardPaymentView, startGiftCardPayment } from "~/.server/services/payments";
import { getSessionGiftCardIds } from "~/.server/session";
import { GiftCardStatus } from "~/features/gift-cards/GiftCardStatus";
import { parseGiftCardId } from "~/lib/gift-cards";
import { metaTranslator } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/gift-card-success";

// Private: kept out of search results, like an order's success page (#85).
export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("giftCards.success.title") }));
}

async function viewer(request: Request) {
  const [user, giftCardIds] = await Promise.all([getUser(request), getSessionGiftCardIds(request)]);
  return { userId: user?.id ?? null, giftCardIds };
}

// The provider's return page for a gift card (#125). Only the buyer (their account, or the browser
// they bought it in) may see it, and with it the code; everyone else gets a 404, so ids can't be
// probed.
export async function loader({ request, params }: Route.LoaderArgs) {
  const giftCardId = parseGiftCardId(params.giftCardId);
  if (giftCardId === null) {
    throw data(null, { status: 404 });
  }
  const card = await getGiftCardView(giftCardId, await viewer(request));
  if (!card) {
    throw data(null, { status: 404 });
  }
  return { card, payment: await getGiftCardPaymentView(giftCardId) };
}

// POST only, from the "Pay" / "Try again" button: a new payment attempt for a still-pending card.
// Starting one writes a `payments` row, so a GET never does.
export async function action({ request, params }: Route.ActionArgs) {
  const giftCardId = parseGiftCardId(params.giftCardId);
  if (giftCardId === null) {
    throw data(null, { status: 404 });
  }
  const locale = await getLocale(request);
  const result = await startGiftCardPayment({
    giftCardId,
    locale,
    origin: new URL(request.url).origin,
    viewer: await viewer(request),
  }).catch((error: unknown) => {
    console.error(`Could not start the payment for gift card ${giftCardId}`, error);
    return null;
  });
  if (result?.ok) {
    return redirect(result.redirectUrl);
  }
  if (result?.error === "not-found") {
    throw data(null, { status: 404 });
  }
  // Paid meanwhile or no provider: the page shows where it stands.
  return redirect(pathFor(locale, "giftCardSuccess", { giftCardId: String(giftCardId) }));
}

export default function GiftCardSuccess({ loaderData }: Route.ComponentProps) {
  return (
    <main className="container mx-auto max-w-3xl px-4 pt-10 pb-16">
      <GiftCardStatus card={loaderData.card} payment={loaderData.payment} />
    </main>
  );
}
