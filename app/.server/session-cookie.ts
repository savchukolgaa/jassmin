// Kept apart from `session.ts`, which reads the env on import, so code that only needs to know
// whether a request carries a session (e.g. blog cache headers) stays env-free.

export const SESSION_COOKIE_NAME = "__jassmin_session";

/** Whether the request sends the session cookie (logged in, or a guest with a cart). */
export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("Cookie");
  if (!cookie) {
    return false;
  }
  return cookie.split(";").some((part) => part.trimStart().startsWith(`${SESSION_COOKIE_NAME}=`));
}
