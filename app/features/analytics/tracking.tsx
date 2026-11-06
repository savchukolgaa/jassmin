// Whether the client tracker may send events (#18, #129): the visitor accepted analytics cookies.
// The `_shop` layout provides it from its loader's `consent`; `/api/events` checks again.
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { clientEvents } from "./client-events";

const TrackingContext = createContext(false);

export function TrackingProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children?: ReactNode;
}) {
  return <TrackingContext value={enabled}>{children}</TrackingContext>;
}

/** Whether client events may be sent; `false` outside the shop layout. */
export function useTrackingAllowed(): boolean {
  return useContext(TrackingContext);
}

/** Sends anything still queued when the page is hidden (tab switch, app switch) or closed. */
export function useFlushOnHide(): void {
  useEffect(() => {
    const flush = () => clientEvents.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
