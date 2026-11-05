// Guards the routes only a known service calls with a shared secret: Strapi on `/cms/*` (#40) and
// the email provider on `/hooks/email` (#134). The caller sends `Authorization: Bearer <secret>`;
// both sides are hashed first, so the comparison is constant-time whatever their lengths.
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * `null` when the request carries `secret` as its bearer token; otherwise the response to send:
 * 503 when the app has no secret configured, 401 for a missing or wrong one.
 */
export function checkBearerSecret(request: Request, secret: string | undefined): Response | null {
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
