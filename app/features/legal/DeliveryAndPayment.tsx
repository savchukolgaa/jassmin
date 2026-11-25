import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { usePathFor, useT } from "~/lib/i18n";
import { DELIVERY_UPDATED_AT } from "~/lib/legal";
import { LegalPage, LegalSection, MoreLink } from "./LegalPage";

/**
 * Delivery and payment (#190): Nova Poshta to a branch or parcel locker (#136), tracked by waybill
 * (#137), free from `FREE_SHIPPING_THRESHOLD`, otherwise the carrier's rates on collection (the shop
 * charges no delivery, `SHIPPING_AMOUNT` is 0). Card payment is listed only while a provider is
 * configured (#44).
 */
export function DeliveryAndPayment({ cardPaymentEnabled }: { cardPaymentEnabled: boolean }) {
  const { t, formatPrice } = useT();
  const path = usePathFor();

  return (
    <LegalPage
      title={t("legal.delivery.title")}
      updatedAt={DELIVERY_UPDATED_AT}
      intro={t("legal.delivery.intro")}
    >
      <LegalSection heading={t("legal.delivery.shipping.heading")}>
        <p>{t("legal.delivery.shipping.carrier")}</p>
        <p>{t("legal.delivery.shipping.tracking")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.delivery.cost.heading")}>
        <p>{t("legal.delivery.cost.free", { threshold: formatPrice(FREE_SHIPPING_THRESHOLD) })}</p>
        <p>{t("legal.delivery.cost.paid")}</p>
        <p>{t("legal.delivery.cost.afterDiscount")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.delivery.payment.heading")}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("legal.delivery.payment.cod")}</li>
          {cardPaymentEnabled ? <li>{t("legal.delivery.payment.card")}</li> : null}
          <li>{t("legal.delivery.payment.giftCard")}</li>
        </ul>
        <p>{t("legal.delivery.payment.currency")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.delivery.inspect.heading")}>
        <p>{t("legal.delivery.inspect.text")}</p>
        <MoreLink label={t("legal.delivery.inspect.more")} to={path("returns")}>
          {t("nav.returns")}
        </MoreLink>
      </LegalSection>
    </LegalPage>
  );
}
