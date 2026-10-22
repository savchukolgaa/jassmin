import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/cart";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Cart — Jassmin" }];
}

// Placeholder until #10.
export default function Cart() {
  return <PagePlaceholder title="Cart" />;
}
