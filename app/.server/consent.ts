// The cookie banner's answer (#18). Doesn't read the env, like `locale.ts`, so any loader,
// middleware or test can check it.
import { createCookie } from "react-router";
import { CONSENT_COOKIE, type ConsentValue, isConsentValue } from "~/lib/consent";

/** `granted` or `denied`, kept for a year. A preference, not an identity, so it isn't signed. */
export const consentCookie = createCookie(CONSENT_COOKIE, {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: import.meta.env.PROD,
  maxAge: 60 * 60 * 24 * 365,
});

/** The visitor's answer to the cookie banner; `null` until they answer (the banner shows). */
export async function getConsent(request: Request): Promise<ConsentValue | null> {
  const value: unknown = await consentCookie.parse(request.headers.get("Cookie"));
  return isConsentValue(value) ? value : null;
}

/** A `Set-Cookie` header that stores the answer. */
export function serializeConsent(consent: ConsentValue): Promise<string> {
  return consentCookie.serialize(consent);
}

/** A `Set-Cookie` header that forgets the answer, so the banner shows again. */
export function clearConsent(): Promise<string> {
  return consentCookie.serialize("", { maxAge: 0 });
}
