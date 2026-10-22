import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/admin";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Admin — Jassmin" }];
}

// Placeholder until #14.
export default function Admin() {
  return <PagePlaceholder title="Admin" />;
}
