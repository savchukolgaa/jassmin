import { cn } from "~/lib/cn";

export const ABOUT_LINK = { to: "/#about", label: "About us" } as const;
export const CONTACTS_LINK = { to: "/#contacts", label: "Kontakt" } as const;
export const BLOG_LINK = { to: "/blog", label: "Blog" } as const;
export const CATALOG_LINKS = [
  { to: "/catalog/men", label: "Men Perfumes", shortLabel: "Men" },
  { to: "/catalog/women", label: "Women Perfumes", shortLabel: "Women" },
] as const;

const [MEN_CATALOG, WOMEN_CATALOG] = CATALOG_LINKS;

/** Links row of the site footer (women first, as in the C+ design). */
export const FOOTER_LINKS = [
  { to: WOMEN_CATALOG.to, label: WOMEN_CATALOG.shortLabel },
  { to: MEN_CATALOG.to, label: MEN_CATALOG.shortLabel },
  BLOG_LINK,
  ABOUT_LINK,
  CONTACTS_LINK,
] as const;

/**
 * Which surface a nav item sits on: the deep-pink header/footer bar (`onPrimary`) or a white
 * panel such as the catalog dropdown and mobile menu (`onLight`).
 */
export type NavTone = "onPrimary" | "onLight";

/** 3px focus ring that keeps at least 3:1 contrast with the surface (see docs/design.md). */
export function focusRing(tone: NavTone = "onPrimary"): string {
  return cn(
    "focus-visible:outline-3 focus-visible:outline-offset-2",
    tone === "onPrimary" ? "focus-visible:outline-white" : "focus-visible:outline-primary",
  );
}

/** Text link in the header nav; `active` highlights the current section. */
export function navItemClasses(active = false, tone: NavTone = "onPrimary"): string {
  return cn(
    "inline-flex min-h-11 items-center gap-1 rounded-pill px-3 text-sm font-bold transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? cn("text-white hover:bg-white/15", active && "underline decoration-2 underline-offset-8")
      : cn("hover:bg-blush", active ? "text-primary" : "text-ink hover:text-primary-dark"),
  );
}

/** Round icon-only link or button in the header bar (profile, menu). */
export function iconButtonClasses(active = false, tone: NavTone = "onPrimary"): string {
  return cn(
    "relative inline-flex size-11 items-center justify-center rounded-full transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? cn("text-white hover:bg-white/15", active && "bg-white/15")
      : cn("hover:bg-blush", active ? "text-primary" : "text-ink"),
  );
}

/** Hides the native disclosure triangle of a `<summary>`. */
export const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
