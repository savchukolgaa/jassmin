import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/checkout";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [{ title: t("meta.title", { page: t("checkout.title") }) }];
}

// Placeholder until #11.
export default function Checkout() {
  const { t } = useT();
  return <PagePlaceholder title={t("checkout.title")} />;
}
