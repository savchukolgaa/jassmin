// Guards the `/cms/*` sync routes (#40), which only Strapi's document middleware calls. Strapi
// sends `Authorization: Bearer <CMS_SYNC_SECRET>`; the comparison is constant-time.
import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * `null` when the request carries the sync secret; otherwise the response to send: 503 when the
 * app has no `CMS_SYNC_SECRET`, 401 for a missing or wrong one.
 */
export function checkCmsSyncAuth(
  request: Request,
  secret: string | undefined = getEnv().CMS_SYNC_SECRET,
): Response | null {
  if (!secret) {
    return Response.json({ error: "not-configured" }, { status: 503 });
  }
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(digest(token), digest(secret))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** The request's JSON body, or `undefined` when it isn't JSON. */
export function readJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}
