import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/blog-post";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Blog post — Jassmin" }];
}

// Placeholder until #13.
export default function BlogPost() {
  return <PagePlaceholder title="Blog post" />;
}
