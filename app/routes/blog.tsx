import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/blog";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Blog — Jassmin" }];
}

// Placeholder until #13.
export default function Blog() {
  return <PagePlaceholder title="Blog" />;
}
