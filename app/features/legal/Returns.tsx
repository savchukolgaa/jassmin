import { useT } from "~/lib/i18n";
import { RETURN_REPORT_DAYS, RETURNS_UPDATED_AT, type SellerDetails } from "~/lib/legal";
import { LegalPage, LegalSection } from "./LegalPage";

/**
 * Returns and exchanges (#190) under the Law "On Consumer Rights Protection": perfume of proper
 * quality can't be returned (CMU resolution No. 172); defective, damaged or wrong items are
 * replaced or refunded when reported within `RETURN_REPORT_DAYS`. The contacts come from Strapi;
 * `seller` is `null` when it's down.
 */
export function Returns({ seller }: { seller: SellerDetails | null }) {
  const { t } = useT();
  const email = seller?.email;
  const phone = seller?.phone;

  return (
    <LegalPage
      title={t("legal.returns.title")}
      updatedAt={RETURNS_UPDATED_AT}
      intro={t("legal.returns.intro")}
    >
      <LegalSection heading={t("legal.returns.quality.heading")}>
        <p>{t("legal.returns.quality.text")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.returns.defects.heading")}>
        <p>{t("legal.returns.defects.text")}</p>
        <p>
          {email && phone
            ? t("legal.returns.defects.report", { days: RETURN_REPORT_DAYS, email, phone })
            : t("legal.returns.defects.reportFallback", { days: RETURN_REPORT_DAYS })}
        </p>
        <p>{t("legal.returns.defects.shipping")}</p>
        <p>{t("legal.returns.defects.refund")}</p>
      </LegalSection>

      <LegalSection heading={t("legal.returns.refuse.heading")}>
        <p>{t("legal.returns.refuse.text")}</p>
      </LegalSection>
    </LegalPage>
  );
}
