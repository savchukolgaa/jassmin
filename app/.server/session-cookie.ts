// Kept apart from `session.ts`, which reads the env on import, so code that only needs to know
// whether a request carries a session (e.g. blog cache headers) stays env-free.
import { CONSENT_COOKIE } from "~/lib/consent";
import { ANONYMOUS_ID_COOKIE } from "./visitor-cookie";

export const SESSION_COOKIE_NAME = "__jassmin_session";

// The auth session, the analytics visitor id that a guest cart hangs off (#10), and the cookie
// banner's answer, which decides whether the page shows the banner (#18).
const PERSONAL_COOKIES = [SESSION_COOKIE_NAME, ANONYMOUS_ID_COOKIE, CONSENT_COOKIE];

/**
 * Whether the request sends a cookie that personalises the page: logged in, a guest who may have
 * a cart, or a visitor who answered the cookie banner.
 */
export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("Cookie");
  if (!cookie) {
    return false;
  }
  return cookie.split(";").some((part) => {
    const name = part.trimStart().split("=", 1)[0];
    return name !== undefined && PERSONAL_COOKIES.includes(name);
  });
}
