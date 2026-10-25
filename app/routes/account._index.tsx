import { requireUser } from "~/.server/services/auth";
import { getAccountOrders } from "~/.server/services/orders";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { CurrentOrderCard } from "~/features/account/CurrentOrderCard";
import { PreviousOrdersList } from "~/features/account/PreviousOrdersList";
import { useT } from "~/lib/i18n";
import { OFFERS_PATH } from "~/lib/offers";
import type { Route } from "./+types/account._index";

// The account layout's loader doesn't protect this one: loaders run in parallel.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return getAccountOrders(user.id);
}

const sectionHeading = "text-3xl font-extrabold tracking-[-0.03em] text-ink md:text-4xl";

export default function AccountOrders({ loaderData }: Route.ComponentProps) {
  const { t } = useT();
  const { current, previous } = loaderData;

  if (current.length === 0 && previous.length === 0) {
    return (
      <section
        aria-labelledby="no-orders-heading"
        className="flex flex-col items-start gap-4 rounded-card-lg bg-blush p-8 md:p-14"
      >
        <h2 id="no-orders-heading" className={sectionHeading}>
          {t("account.orders.empty.heading")}
        </h2>
        <p className="max-w-md text-lg text-body">{t("account.orders.empty.text")}</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink to={OFFERS_PATH}>{t("account.orders.empty.offers")}</ButtonLink>
          <ButtonLink to="/catalog/women" variant="dark">
            {t("account.orders.empty.women")}
          </ButtonLink>
          <ButtonLink to="/catalog/men" variant="dark">
            {t("account.orders.empty.men")}
          </ButtonLink>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-14">
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
    </div>
  );
}
