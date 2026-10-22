import { cn } from "~/lib/cn";

export const ABOUT_LINK = { to: "/#about", label: "About us" } as const;
export const CONTACTS_LINK = { to: "/#contacts", label: "Kontakt" } as const;
export const CATALOG_LINKS = [
  { to: "/catalog/men", label: "Men Perfumes" },
  { to: "/catalog/women", label: "Women Perfumes" },
] as const;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Text link in the header nav; `active` highlights the current section. */
export function navItemClasses(active = false): string {
  return cn(
    "inline-flex h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium",
    "transition-colors hover:text-primary",
    focusRing,
    active ? "text-primary" : "text-gray-700 dark:text-gray-200",
  );
}

/** Round icon-only link or button in the header (profile, cart, menu). */
export function iconButtonClasses(active = false): string {
  return cn(
    "relative inline-flex size-11 items-center justify-center rounded-full",
    "transition-colors hover:bg-primary-light/15 hover:text-primary",
    focusRing,
    active ? "text-primary" : "text-gray-700 dark:text-gray-200",
  );
}

/** Hides the native disclosure triangle of a `<summary>`. */
export const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
