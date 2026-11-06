import { data, useNavigation } from "react-router";
import { getEnv, getSiteUrl } from "~/.server/env";
import { getLocale } from "~/.server/locale";
import { verificationEmailLimiter } from "~/.server/rate-limit";
import { requireUser } from "~/.server/services/auth";
import { sendVerificationEmail } from "~/.server/services/email-verification";
import { getAccountGiftCards } from "~/.server/services/gift-cards";
import { getAccountOrders } from "~/.server/services/orders";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { AccountGiftCards } from "~/features/account/AccountGiftCards";
import { CurrentOrderCard } from "~/features/account/CurrentOrderCard";
import { PreviousOrdersList } from "~/features/account/PreviousOrdersList";
import { VerifyEmailBanner } from "~/features/account/VerifyEmailBanner";
import { resendVerificationSchema } from "~/lib/auth.schema";
import { type TextKey, usePathFor, useT } from "~/lib/i18n";
import type { Route } from "./+types/account._index";

// The account layout's loader doesn't protect this one: loaders run in parallel.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const [orders, giftCards] = await Promise.all([
    getAccountOrders(user.id),
    getAccountGiftCards(user.id),
  ]);
  // The "Confirm your email" banner (#135), until the email is confirmed.
  return { ...orders, giftCards, email: user.email, emailVerified: user.emailVerified };
}

export type ResendVerificationActionData = { resent: true } | { error: TextKey };

/** Sends the verification email again (#135), at most 3 times per user per hour. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const parsed = resendVerificationSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data<ResendVerificationActionData>({ error: "errors.invalid" }, { status: 400 });
  }
  if (user.emailVerified) {
    return data<ResendVerificationActionData>({ resent: true });
  }

  const key = String(user.id);
  if (await verificationEmailLimiter.isBlocked(key)) {
    return data<ResendVerificationActionData>(
      { error: "auth.errors.tooManyRequests" },
      { status: 429 },
    );
  }
  await verificationEmailLimiter.hit(key);
  void sendVerificationEmail({
    userId: user.id,
    locale: await getLocale(request),
    siteUrl: getSiteUrl(getEnv(), request),
  });
  return data<ResendVerificationActionData>({ resent: true });
}

const sectionHeading = "text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl";

export default function AccountOrders({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const path = usePathFor();
  const { current, previous, giftCards } = loaderData;
  // The cards the user bought (#125), under their orders or the "no orders yet" panel.
  const cards = giftCards.length > 0 && <AccountGiftCards cards={giftCards} />;
  const submitting = useNavigation().state === "submitting";
  const banner = !loaderData.emailVerified && (
    <VerifyEmailBanner
      email={loaderData.email}
      resent={actionData !== undefined && "resent" in actionData}
      error={actionData && "error" in actionData ? actionData.error : undefined}
      submitting={submitting}
    />
  );

  if (current.length === 0 && previous.length === 0) {
    return (
      <div className="flex flex-col gap-14">
        {banner}
        <section
          aria-labelledby="no-orders-heading"
          className="flex flex-col items-start gap-4 rounded-card-lg bg-blush p-8 md:p-14"
        >
          <h2 id="no-orders-heading" className={sectionHeading}>
            {t("account.orders.empty.heading")}
          </h2>
          <p className="max-w-md text-lg text-body">{t("account.orders.empty.text")}</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={path("offers")}>{t("account.orders.empty.offers")}</ButtonLink>
            <ButtonLink to={path("catalog", { gender: "women" })} variant="dark">
              {t("account.orders.empty.women")}
            </ButtonLink>
            <ButtonLink to={path("catalog", { gender: "men" })} variant="dark">
              {t("account.orders.empty.men")}
            </ButtonLink>
          </div>
        </section>
        {cards}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      {banner}
      {current.length > 0 && (
        <section aria-labelledby="current-orders-heading" className="flex flex-col gap-5">
          <h2 id="current-orders-heading" className={sectionHeading}>
            {t("account.orders.current")}
          </h2>
          {current.map((order) => (
            <CurrentOrderCard key={order.id} order={order} />
          ))}
        </section>
      )}
      {previous.length > 0 && (
        <section aria-labelledby="previous-orders-heading" className="flex flex-col gap-4">
          <h2 id="previous-orders-heading" className={sectionHeading}>
            {t("account.orders.previous")}
          </h2>
          <PreviousOrdersList orders={previous} />
        </section>
      )}
      {cards}
    </div>
  );
}
