import type { SVGProps } from "react";

// The perfumer chat's decorative icons (24×24, currentColor), as drawn on the C+ canvas (#163). The
// surrounding button or text carries the meaning.

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A round perfume bottle, the perfumer's avatar; `sparkle` adds the star of the header strip. */
export function BottleIcon({ sparkle = false, ...props }: IconProps & { sparkle?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M10 3h4v3h-4z" />
      <path d="M8 6h8l1 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z" />
      {sparkle && <path d="M12 12.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />}
    </Icon>
  );
}

export function QuestionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </Icon>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </Icon>
  );
}

export function RestartIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </Icon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.4} {...props}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </Icon>
  );
}

/** A tick: a catalog search the perfumer finished (#164). */
export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.6} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}
