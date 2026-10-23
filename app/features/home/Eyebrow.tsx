import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type EyebrowProps = {
  children: ReactNode;
  /** `onDark` for `ink` sections, where the soft-pink accent is readable. */
  tone?: "default" | "onDark";
};

/** Small uppercase label above a section heading. */
export function Eyebrow({ children, tone = "default" }: EyebrowProps) {
  return (
    <p
      className={cn(
        "text-sm font-bold tracking-widest uppercase",
        tone === "onDark" ? "text-primary-light" : "text-primary-dark",
      )}
    >
      {children}
    </p>
  );
}
