import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { useT } from "~/lib/i18n";
import type { Route } from "./+types/checkout";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Checkout — Jassmin" }];
}

// Placeholder until #11.
export default function Checkout() {
  const { t } = useT();
  return <PagePlaceholder title={t("checkout.title")} />;
}
