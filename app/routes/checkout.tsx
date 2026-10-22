import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/checkout";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Checkout — Jassmin" }];
}

// Placeholder until #11.
export default function Checkout() {
  return <PagePlaceholder title="Checkout" />;
}
