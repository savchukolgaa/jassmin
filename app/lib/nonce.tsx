// The request's Content-Security-Policy nonce (#143). `entry.server.tsx` provides it while the page
// renders on the server. Never put it in loader data.
//
// In the browser it's read back from a nonced script's `nonce` property, so hydration renders the
// same value as the server did: browsers keep a `<link>`'s nonce attribute (React Router's
// `<Links>`), but hide a `<script>`'s (the attribute reads ""), which is why the root layout's
// inline script suppresses the hydration warning. Any script on the page can read the nonce
// anyway; scripts injected into the HTML can't, because the CSP never lets them run.
import { createContext, useContext } from "react";

function documentNonce(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
}

const NonceContext = createContext(documentNonce());

export const NonceProvider = NonceContext.Provider;

/** The nonce for inline `<script>` tags and `<Links>`: the CSP blocks inline scripts without it. */
export function useNonce(): string {
  return useContext(NonceContext);
}
