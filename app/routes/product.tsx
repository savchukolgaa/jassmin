import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/product";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Product — Jassmin" }];
}

// Placeholder until #8.
export default function Product() {
  return <PagePlaceholder title="Product" />;
}
