import type { SocialLink } from "~/lib/cms";
import { SOCIAL_LABELS } from "~/lib/cms";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { SOCIAL_ICONS } from "./icons";
import { iconButtonClasses, type NavTone } from "./nav";

/** The surface the icons sit on: the footer (`onPrimary`), the mobile menu (`onLight`) or `ink`. */
export type SocialTone = NavTone | "onInk";

// On `ink`, the focus ring is `primary-light` (7.93:1, docs/design.md), like the contact links.
const onInkClasses = cn(
  "relative inline-flex size-11 items-center justify-center rounded-full text-primary-light transition-colors",
  "hover:bg-white/10 hover:text-white",
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary-light",
);

type SocialLinksProps = {
  /** Already cleaned and ordered by `normalizeSocialLinks` (in `toSiteSettings`). */
  links: readonly SocialLink[];
  tone: SocialTone;
  className?: string;
};

/**
 * The store's social profiles from Strapi site settings as round 44px icon links that open in a new
 * tab (#101). Renders nothing without links, e.g. while Strapi is down.
 */
export function SocialLinks({ links, tone, className }: SocialLinksProps) {
  const { t } = useT();
  const shown = links.filter((link) => link.url !== "");
  if (shown.length === 0) {
    return null;
  }

  const linkClasses = tone === "onInk" ? onInkClasses : iconButtonClasses(false, tone);
  return (
    <ul aria-label={t("social.title")} className={cn("-mx-1 flex flex-wrap gap-1", className)}>
      {shown.map(({ platform, url }) => {
        const Icon = SOCIAL_ICONS[platform];
        return (
          <li key={`${platform}-${url}`}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("social.linkLabel", { platform: SOCIAL_LABELS[platform] })}
              className={linkClasses}
            >
              <Icon className="size-6" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
