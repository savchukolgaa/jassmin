import { useEffect, useState } from "react";

// The perfumer's intro "typing in" as it streams (#164): the text arrives a sentence at a time,
// and the part not yet shown is revealed a few characters per frame. With reduced motion it
// appears at once. Plain text only, like every model text in the chat.

/** Milliseconds per revealed character. */
export const TYPING_MS_PER_CHAR = 15;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function TypingText({ text }: { text: string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (shown >= text.length) return;
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    const timer = setTimeout(() => setShown((count) => count + 1), TYPING_MS_PER_CHAR);
    return () => clearTimeout(timer);
  }, [shown, text]);

  return <>{text.slice(0, shown)}</>;
}
