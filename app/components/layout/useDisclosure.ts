import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/**
 * Enhances a `<details>` disclosure (which already works without JS): mirrors its state into
 * `aria-expanded` and closes it on Escape (returning focus to the `<summary>`), on a click
 * outside and after navigating.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // Close after any navigation, including picking a link inside the disclosure.
  const { key } = useLocation();
  const [locationKey, setLocationKey] = useState(key);
  if (key !== locationKey) {
    setLocationKey(key);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        summaryRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return {
    detailsProps: {
      ref: detailsRef,
      open,
      onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setOpen(event.currentTarget.open),
    },
    summaryProps: { ref: summaryRef, "aria-expanded": open },
  };
}
