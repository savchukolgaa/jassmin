import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type EyebrowProps = {
  children: ReactNode;
  /**
   * `onDark` for `ink` sections, where the soft-pink accent is readable; `onPrimary` for white on
   * deep-pink cards.
   */
  tone?: "default" | "onDark" | "onPrimary";
};

const TONES = {
  default: "text-primary-dark",
  onDark: "text-primary-light",
  onPrimary: "text-white",
} as const;

/** Small uppercase label above a section heading. */
export function Eyebrow({ children, tone = "default" }: EyebrowProps) {
  return (
    <p className={cn("text-sm font-extrabold tracking-[0.1em] uppercase", TONES[tone])}>
      {children}
    </p>
  );
}
