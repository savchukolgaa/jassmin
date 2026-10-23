import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type EyebrowProps = {
  children: ReactNode;
  /** `onDark` for sections with a dark background. */
  tone?: "default" | "onDark";
};

/** Small uppercase label above a section heading. */
export function Eyebrow({ children, tone = "default" }: EyebrowProps) {
  return (
    <p
      className={cn(
        "text-sm font-bold tracking-widest uppercase",
        tone === "onDark" ? "text-primary-light" : "text-gray-600 dark:text-gray-400",
      )}
    >
      {children}
    </p>
  );
}
