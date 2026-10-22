import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/login";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Log in — Jassmin" }];
}

// Placeholder until #9.
export default function Login() {
  return <PagePlaceholder title="Log in" />;
}
