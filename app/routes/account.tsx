import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/account";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My account — Jassmin" }];
}

// Placeholder until #12.
export default function Account() {
  return <PagePlaceholder title="My account" />;
}
