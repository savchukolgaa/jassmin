import { isCardPaymentAvailable } from "~/.server/services/payments";
import { DeliveryAndPayment } from "~/features/legal/DeliveryAndPayment";
import { metaTranslator } from "~/lib/i18n";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/delivery-and-payment";

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("legal.delivery.title") }),
      description: t("legal.delivery.description"),
    },
  );
}

// Delivery and payment (#190): card payment is listed only while a provider is configured (#44).
export function loader(): { cardPaymentEnabled: boolean } {
  return { cardPaymentEnabled: isCardPaymentAvailable() };
}

export default function DeliveryAndPaymentPage({ loaderData }: Route.ComponentProps) {
  return <DeliveryAndPayment cardPaymentEnabled={loaderData.cardPaymentEnabled} />;
}
