import { cn } from "~/lib/cn";
import { type Locale, type TextKey, useT } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";

/** A nav link; the label is a message key, translated where it's rendered. */
export interface NavLinkItem {
  to: string;
  labelKey: TextKey;
}

/** The site's nav links in `locale` (#84): header, mobile menu, catalog dropdown and footer. */
export function navLinks(locale: Locale) {
  const about = {
    to: pathFor(locale, "home", {}, { hash: "about" }),
    labelKey: "nav.about",
  } as const satisfies NavLinkItem;
  const contacts = {
    to: pathFor(locale, "home", {}, { hash: "contacts" }),
    labelKey: "nav.contacts",
  } as const satisfies NavLinkItem;
  const blog = { to: pathFor(locale, "blog"), labelKey: "nav.blog" } as const satisfies NavLinkItem;
  /** The popular perfumes (#67), labelled "Bestsellers" in the header. */
  const bestsellers = {
    to: pathFor(locale, "popular"),
    labelKey: "nav.bestsellers",
  } as const satisfies NavLinkItem;
  const offers = {
    to: pathFor(locale, "offers"),
    labelKey: "nav.offers",
  } as const satisfies NavLinkItem;
  const privacy = {
    to: pathFor(locale, "privacy"),
    labelKey: "consent.learnMore",
  } as const satisfies NavLinkItem;
  const men = {
    to: pathFor(locale, "catalog", { gender: "men" }),
    labelKey: "catalog.title.men",
    shortLabelKey: "catalog.short.men",
  } as const satisfies NavLinkItem & { shortLabelKey: TextKey };
  const women = {
    to: pathFor(locale, "catalog", { gender: "women" }),
    labelKey: "catalog.title.women",
    shortLabelKey: "catalog.short.women",
  } as const satisfies NavLinkItem & { shortLabelKey: TextKey };
  return {
    about,
    contacts,
    blog,
    bestsellers,
    offers,
    privacy,
    catalog: [men, women],
    /** Links row of the site footer (women first, as in the C+ design). */
    footer: [
      { to: women.to, labelKey: women.shortLabelKey },
      { to: men.to, labelKey: men.shortLabelKey },
      offers,
      blog,
      about,
      contacts,
      privacy,
    ] satisfies NavLinkItem[],
  };
}

/** `navLinks` in the active locale. */
export function useNavLinks(): ReturnType<typeof navLinks> {
  return navLinks(useT().locale);
}

// On deep pink, hover and active states darken to `primary-dark`: a translucent white overlay
// would drop white text below 4.5:1.

/**
 * Which surface a nav item sits on: the deep-pink footer and hero bands (`onPrimary`) or a white
 * surface such as the header bar, its catalog dropdown and mobile menu (`onLight`, #72).
 */
export type NavTone = "onPrimary" | "onLight";

/** 3px focus ring that keeps at least 3:1 contrast with the surface (see docs/design.md). */
export function focusRing(tone: NavTone = "onPrimary"): string {
  return cn(
    "focus-visible:outline-3 focus-visible:outline-offset-2",
    tone === "onPrimary" ? "focus-visible:outline-white" : "focus-visible:outline-primary",
  );
}

/**
 * Text link in a nav; `active` highlights the current section. `underline` marks it with more than
 * colour, as the header bar does; the dropdown and mobile menu panels go without.
 */
export function navItemClasses(
  active = false,
  tone: NavTone = "onPrimary",
  { underline = tone === "onPrimary" }: { underline?: boolean } = {},
): string {
  return cn(
    "inline-flex min-h-11 items-center gap-1 rounded-pill px-3 text-sm font-bold transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? "text-white hover:bg-primary-dark"
      : cn("hover:bg-blush", active ? "text-primary-dark" : "text-ink hover:text-primary-dark"),
    active && underline && "underline decoration-2 underline-offset-8",
  );
}

/** Text link in the white header bar, underlined when it's the current section. */
export function headerNavItemClasses(active = false): string {
  return navItemClasses(active, "onLight", { underline: true });
}

/** Round icon-only link or button (profile, menu); the header bar passes `"onLight"`. */
export function iconButtonClasses(active = false, tone: NavTone = "onPrimary"): string {
  return cn(
    "relative inline-flex size-11 items-center justify-center rounded-full transition-colors",
    focusRing(tone),
    tone === "onPrimary"
      ? cn("text-white hover:bg-primary-dark", active && "bg-primary-dark")
      : cn("hover:bg-blush", active ? "bg-blush text-primary-dark" : "text-ink"),
  );
}

/** Hides the native disclosure triangle of a `<summary>`. */
export const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
