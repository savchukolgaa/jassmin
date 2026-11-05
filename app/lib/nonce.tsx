// The request's Content-Security-Policy nonce (#143). `entry.server.tsx` provides it while the page
// renders on the server; in the browser it's "" (browsers hide the attribute after parsing, so
// hydration sees "" on both sides). Never put the nonce in loader data.
import { createContext, useContext } from "react";

const NonceContext = createContext("");

export const NonceProvider = NonceContext.Provider;

/** The nonce for inline `<script>` tags: the CSP blocks inline scripts without it. */
export function useNonce(): string {
  return useContext(NonceContext);
}
