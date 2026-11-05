// Guards the `/cms/*` sync routes (#40), which only Strapi's document middleware calls. Strapi
// sends `Authorization: Bearer <CMS_SYNC_SECRET>`, checked by the shared `checkBearerSecret`.
import { checkBearerSecret } from "../bearer-auth";
import { getEnv } from "../env";

/**
 * `null` when the request carries the sync secret; otherwise the response to send: 503 when the
 * app has no `CMS_SYNC_SECRET`, 401 for a missing or wrong one.
 */
export function checkCmsSyncAuth(
  request: Request,
  secret: string | undefined = getEnv().CMS_SYNC_SECRET,
): Response | null {
  return checkBearerSecret(request, secret);
}

/** The request's JSON body, or `undefined` when it isn't JSON. */
export function readJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}
