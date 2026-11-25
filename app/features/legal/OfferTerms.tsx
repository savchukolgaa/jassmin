import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { GIFT_CARD_AMOUNTS, GIFT_CARD_VALIDITY_MONTHS } from "~/lib/gift-cards";
import { usePathFor, useT } from "~/lib/i18n";
import { OFFER_UPDATED_AT, type SellerDetails } from "~/lib/legal";
import { LegalPage, LegalSection, MoreLink } from "./LegalPage";
import { SellerDetailsList } from "./SellerDetailsList";

/**
 * The public offer (#190), the contract of sale (Civil Code arts. 633, 641). The threshold and
 * gift-card amounts come from the code constants; the seller's details from Strapi, at the top and
 * again at the end. The copy is a draft for the owner to review (docs/legal.md).
 */
export function OfferTerms({
  seller,
  showPlaceholders,
}: {
  seller: SellerDetails | null;
  showPlaceholders: boolean;
}) {
  const { t, formatPrice } = useT();
  const path = usePathFor();
  const details = <SellerDetailsList seller={seller} showPlaceholders={showPlaceholders} />;

  return (
    <LegalPage
      title={t("legal.offer.title")}
      updatedAt={OFFER_UPDATED_AT}
      intro={t("legal.offer.intro")}
    >
      <LegalSection heading={t("legal.offer.parties.heading")}>
        <p>{t("legal.offer.parties.seller")}</p>
        {details}
        <p>{t("legal.offer.parties.buyer")}</p>
        <p>{t("legal.offer.parties.offer")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.subject.heading")}>
        <p>{t("legal.offer.subject.text")}</p>
        <p>{t("legal.offer.subject.info")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.order.heading")}>
        <p>{t("legal.offer.order.place")}</p>
        <p>{t("legal.offer.order.accept")}</p>
        <p>{t("legal.offer.order.confirm")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.prices.heading")}>
        <p>{t("legal.offer.prices.currency")}</p>
        <p>{t("legal.offer.prices.payment")}</p>
        <p>{t("legal.offer.prices.change")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.delivery.heading")}>
        <p>{t("legal.offer.delivery.text", { threshold: formatPrice(FREE_SHIPPING_THRESHOLD) })}</p>
        <MoreLink label={t("legal.offer.delivery.more")} to={path("deliveryAndPayment")}>
          {t("nav.deliveryAndPayment")}
        </MoreLink>
      </LegalSection>

      <LegalSection heading={t("legal.offer.ownership.heading")}>
        <p>{t("legal.offer.ownership.text")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.returns.heading")}>
        <p>{t("legal.offer.returns.text")}</p>
        <MoreLink label={t("legal.offer.returns.more")} to={path("returns")}>
          {t("nav.returns")}
        </MoreLink>
      </LegalSection>

      <LegalSection heading={t("legal.offer.discounts.heading")}>
        <p>
          {t("legal.offer.discounts.giftCards", {
            amounts: GIFT_CARD_AMOUNTS.map((amount) => formatPrice(String(amount))).join(", "),
          })}
        </p>
        <p>{t("legal.offer.discounts.giftCardUse", { months: GIFT_CARD_VALIDITY_MONTHS })}</p>
        <p>{t("legal.offer.discounts.promotions")}</p>
        <MoreLink label={t("legal.offer.discounts.more")} to={path("offers")}>
          {t("nav.offers")}
        </MoreLink>
      </LegalSection>

      <LegalSection heading={t("legal.offer.personalData.heading")}>
        <p>{t("legal.offer.personalData.text")}</p>
        <MoreLink label={t("legal.offer.personalData.more")} to={path("privacy")}>
          {t("consent.learnMore")}
        </MoreLink>
      </LegalSection>

      <LegalSection heading={t("legal.offer.liability.heading")}>
        <p>{t("legal.offer.liability.liability")}</p>
        <p>{t("legal.offer.liability.disputes")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.offer.details.heading")}>{details}</LegalSection>
    </LegalPage>
  );
}
