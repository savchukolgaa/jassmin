import type { SocialLink } from "~/lib/cms";
import { SOCIAL_LABELS } from "~/lib/cms";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { SOCIAL_ICONS } from "./icons";
import { iconButtonClasses, type NavTone } from "./nav";

/** The surface the icons sit on: the footer (`onPrimary`), the mobile menu (`onLight`) or `ink`. */
export type SocialTone = NavTone | "onInk";

// On `ink`, the focus ring is `primary-light` (7.93:1, docs/design.md), like the contact links.
const onInkFocus =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary-light";

const onInkClasses = cn(
  "relative inline-flex size-11 items-center justify-center rounded-full text-primary-light transition-colors",
  "hover:bg-white/10 hover:text-white",
  onInkFocus,
);

// A pill at least 44px tall with a 32px icon and the platform name (#111). `text-lg font-bold`
// matches the phone and email rows of the contacts section.
const labelledOnInkClasses = cn(
  "inline-flex min-h-11 items-center gap-3 rounded-pill px-3 py-1.5 text-lg font-bold text-white transition-colors",
  "hover:bg-white/10 hover:text-primary-light",
  onInkFocus,
);

type SocialLinksProps = {
  /** Already cleaned and ordered by `normalizeSocialLinks` (in `toSiteSettings`). */
  links: readonly SocialLink[];
  className?: string;
} & (
  | { variant?: "icon"; tone: SocialTone }
  /** Only the contacts section on `ink` shows labelled links. */
  | { variant: "labelled"; tone: "onInk" }
);

/**
 * The store's social profiles from Strapi site settings as links that open in a new tab (#101).
 * The `icon` variant (footer, mobile menu) shows round 44px icon links; the `labelled` variant
 * (home contacts) shows a bigger icon followed by the platform name (#111). Renders nothing
 * without links, e.g. while Strapi is down.
 */
export function SocialLinks({ links, tone, variant = "icon", className }: SocialLinksProps) {
  const { t } = useT();
  const shown = links.filter((link) => link.url !== "");
  if (shown.length === 0) {
    return null;
  }

  const labelled = variant === "labelled";
  const linkClasses = labelled
    ? labelledOnInkClasses
    : tone === "onInk"
      ? onInkClasses
      : iconButtonClasses(false, tone);
  return (
    <ul
      aria-label={t("social.title")}
      className={cn(
        labelled ? "-mx-3 flex flex-wrap gap-x-2 gap-y-1" : "-mx-1 flex flex-wrap gap-1",
        className,
      )}
    >
      {shown.map(({ platform, url }) => {
        const Icon = SOCIAL_ICONS[platform];
        const label = SOCIAL_LABELS[platform];
        return (
          <li key={`${platform}-${url}`}>
            {/* The accessible name contains the visible label (WCAG 2.5.3 Label in Name). */}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("social.linkLabel", { platform: label })}
              className={linkClasses}
            >
              {labelled ? (
                <>
                  <Icon className="size-8 shrink-0 text-primary-light" />
                  <span>{label}</span>
                </>
              ) : (
                <Icon className="size-6" />
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
