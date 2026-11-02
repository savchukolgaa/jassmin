import type { ComponentType, SVGProps } from "react";
import type { SocialPlatform } from "~/lib/cms";

type IconProps = SVGProps<SVGSVGElement>;

// Decorative outline icons (24×24, currentColor); the surrounding link or button carries the label.
function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </Icon>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 7V6a3 3 0 0 1 6 0v1" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Icon>
  );
}

// Social platform glyphs (#101): the platforms' own marks, simplified to the same 24×24 outline style
// and drawn in `currentColor`, so they take the brand colour of the surface rather than their own.

export function InstagramIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function TelegramIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.5 4 2.5 11.3l6 2.2 2.3 6.5 3.4-4.2 5.3 4.2L21.5 4Z" />
      <path d="m8.5 13.5 13-9.5" />
      <path d="m10.8 20 .7-4.7" />
    </Icon>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.5 3H13a4 4 0 0 0-4 4v3H6.5v3.5H9V21h3.5v-7.5h2.8l.7-3.5h-3.5V7.5a1 1 0 0 1 1-1h2Z" />
    </Icon>
  );
}

export function TikTokIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M13.5 3c.4 2.6 2.4 4.6 5 5" />
    </Icon>
  );
}

export function ViberIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.5c5 0 8.5 1.6 8.5 7.5s-3.5 7.5-8.5 7.5c-.8 0-1.6 0-2.3-.1L6.5 21v-4.2C4.2 15.8 3.5 13.6 3.5 10c0-5.9 3.5-7.5 8.5-7.5Z" />
      <path d="M9 7.5c0 3.3 2.2 5.5 5.5 5.5l1-1.5-2-1-1 .8c-.9-.4-1.6-1.1-2-2l.8-1-1-2-1.3.7Z" />
    </Icon>
  );
}

export function YouTubeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9 5 3-5 3V9Z" />
    </Icon>
  );
}

/** The glyph for each platform; a missing one fails `pnpm typecheck`. */
export const SOCIAL_ICONS: Record<SocialPlatform, ComponentType<IconProps>> = {
  instagram: InstagramIcon,
  telegram: TelegramIcon,
  facebook: FacebookIcon,
  tiktok: TikTokIcon,
  viber: ViberIcon,
  youtube: YouTubeIcon,
};

// Flags for the language switcher, drawn as SVG because Windows shows flag emoji as letters.
// Decorative: the switcher's buttons also show the language code.

export function FlagUaIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 3 2" aria-hidden="true" {...props}>
      <rect width="3" height="1" fill="#0057B7" />
      <rect y="1" width="3" height="1" fill="#FFD700" />
    </svg>
  );
}

/** The Union Jack, simplified for a 16px-high icon. */
export function FlagGbIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true" {...props}>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0L60 30M60 0L0 30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M0 0L60 30M60 0L0 30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30 0V30M0 15H60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30 0V30M0 15H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}
