// Kept apart from `session.ts`, which reads the env on import, so code that only needs to know
// whether a request carries a session (e.g. blog cache headers) stays env-free.
import { ANONYMOUS_ID_COOKIE } from "./visitor-cookie";

export const SESSION_COOKIE_NAME = "__jassmin_session";

// The auth session, or the analytics visitor id that a guest cart hangs off (#10).
const PERSONAL_COOKIES = [SESSION_COOKIE_NAME, ANONYMOUS_ID_COOKIE];

/**
 * Whether the request sends a cookie that personalises the page: logged in, or a guest who may
 * have a cart.
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
