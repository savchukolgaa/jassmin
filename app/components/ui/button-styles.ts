import { cn } from "~/lib/cn";

export type ButtonVariant = "primary" | "dark" | "outline-light" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonStyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

// Pill buttons from the C+ design (docs/design.md). The hover scale only runs when motion is allowed.
const base = cn(
  "inline-flex items-center justify-center gap-2 rounded-pill font-extrabold tracking-tight",
  "transition-[box-shadow,background-color,color,scale] duration-200",
  "motion-safe:not-disabled:hover:scale-[1.03]",
  "focus-visible:outline-3 focus-visible:outline-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none",
);

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-primary text-white shadow-button focus-visible:outline-primary",
    "hover:bg-primary-dark hover:shadow-button-hover disabled:bg-primary",
  ),
  // For "Order Now" and other CTAs on blush or pink-tinted sections.
  dark: "bg-ink text-white focus-visible:outline-ink hover:bg-black disabled:bg-ink",
  // For use on deep-pink surfaces (header, footer, hero bands).
  "outline-light": cn(
    "border-2 border-white text-white focus-visible:outline-white",
    "hover:bg-white/15 disabled:bg-transparent",
  ),
  ghost: cn(
    "text-primary-dark focus-visible:outline-primary",
    "hover:bg-primary/10 disabled:bg-transparent",
  ),
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-11 px-5 text-sm",
  md: "min-h-13 px-7 text-base",
  lg: "min-h-14.5 px-9 text-lg",
};

/** Class names shared by `Button` and `ButtonLink`, so both always look the same. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}
