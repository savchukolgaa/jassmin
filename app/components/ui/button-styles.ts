import { cn } from "~/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonStyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

const base = cn(
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold",
  "transition-[box-shadow,background-color,color] duration-200",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none",
);

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-primary text-white shadow-md shadow-primary/25",
    "hover:bg-primary-dark hover:shadow-lg disabled:bg-primary",
  ),
  secondary: cn(
    "border border-primary bg-white text-primary dark:bg-gray-950",
    "hover:bg-primary-light/15 disabled:bg-white dark:disabled:bg-gray-950",
  ),
  ghost: "text-primary hover:bg-primary-light/15 disabled:bg-transparent",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-base",
  lg: "h-13 px-8 text-lg",
};

/** Class names shared by `Button` and `ButtonLink`, so both always look the same. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}
