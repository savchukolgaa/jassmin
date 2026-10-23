import { cn } from "~/lib/cn";
import type { TextKey } from "~/lib/i18n";

/** A nav link; the label is a message key, translated where it's rendered. */
export interface NavLinkItem {
  to: string;
  labelKey: TextKey;
}

export const ABOUT_LINK = { to: "/#about", labelKey: "nav.about" } as const satisfies NavLinkItem;
export const CONTACTS_LINK = {
  to: "/#contacts",
  labelKey: "nav.contacts",
} as const satisfies NavLinkItem;
export const BLOG_LINK = { to: "/blog", labelKey: "nav.blog" } as const satisfies NavLinkItem;
export const CATALOG_LINKS = [
  { to: "/catalog/men", labelKey: "catalog.title.men", shortLabelKey: "catalog.short.men" },
  { to: "/catalog/women", labelKey: "catalog.title.women", shortLabelKey: "catalog.short.women" },
] as const satisfies (NavLinkItem & { shortLabelKey: TextKey })[];

const [MEN_CATALOG, WOMEN_CATALOG] = CATALOG_LINKS;

/** Links row of the site footer (women first, as in the C+ design). */
export const FOOTER_LINKS = [
  { to: WOMEN_CATALOG.to, labelKey: WOMEN_CATALOG.shortLabelKey },
  { to: MEN_CATALOG.to, labelKey: MEN_CATALOG.shortLabelKey },
  BLOG_LINK,
  ABOUT_LINK,
  CONTACTS_LINK,
] as const;

// On deep pink, hover and active states darken to `primary-dark`: a translucent white overlay
// would drop white text below 4.5:1.

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
      ? cn(
          "text-white hover:bg-primary-dark",
          active && "underline decoration-2 underline-offset-8",
        )
      : cn("hover:bg-blush", active ? "text-primary" : "text-ink hover:text-primary-dark"),
  );
}

/** Round icon-only link or button in the header bar (profile, menu). */
export function iconButtonClasses(active = false, tone: NavTone = "onPrimary"): string {
  return cn(
    "relative inline-flex size-11 items-center justify-center rounded-full transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? cn("text-white hover:bg-primary-dark", active && "bg-primary-dark")
      : cn("hover:bg-blush", active ? "text-primary" : "text-ink"),
  );
}

/** Hides the native disclosure triangle of a `<summary>`. */
export const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
