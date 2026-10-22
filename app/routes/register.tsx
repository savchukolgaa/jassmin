import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/register";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Sign up — Jassmin" }];
}

// Placeholder until #9.
export default function Register() {
  return <PagePlaceholder title="Sign up" />;
}
