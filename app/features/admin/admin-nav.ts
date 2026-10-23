import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";

/** Sidebar links of the admin area. Product (#16) and order (#17) management nest under these. */
export const ADMIN_NAV_ITEMS = [
  { to: "/admin/products", label: "Products" },
  { to: "/admin/orders", label: "Orders" },
] as const;

/**
 * The Strapi admin panel on `strapiUrl` (blog and site content are edited there, #20). Keeps a
 * path prefix such as `https://example.com/cms`.
 */
export function strapiAdminUrl(strapiUrl: string): string {
  const base = strapiUrl.endsWith("/") ? strapiUrl : `${strapiUrl}/`;
  return new URL("admin", base).toString();
}

/** A link in the admin sidebar (a row on mobile); `active` marks the current section. */
export function adminNavItemClasses(active = false): string {
  return cn(
    "inline-flex min-h-11 items-center gap-1 rounded-pill px-4 text-sm font-bold whitespace-nowrap transition-colors",
    focusRing("onLight"),
    active ? "bg-blush text-primary-dark" : "text-ink hover:bg-blush hover:text-primary-dark",
  );
}
