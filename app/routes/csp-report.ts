import { readLimitedBody } from "~/.server/client-events";
import {
  cspReportLimiter,
  logCspViolation,
  MAX_CSP_REPORT_BYTES,
  parseCspReport,
} from "~/.server/csp-report";
import { getClientIp } from "~/.server/rate-limit";
import type { Route } from "./+types/csp-report";

function status(code: number, headers?: HeadersInit): Response {
  return new Response(null, { status: code, headers });
}

// POST only: Content-Security-Policy violation reports from browsers (#143), in both formats
// (`report-uri` and the Reporting API's `report-to`). Each violation is logged; nothing is stored.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return status(405, { Allow: "POST" });
  }
  const key = getClientIp(request) ?? "anonymous";
  if (cspReportLimiter.isBlocked(key)) {
    return status(429);
  }
  cspReportLimiter.hit(key);

  const text = await readLimitedBody(request, MAX_CSP_REPORT_BYTES).catch(() => null);
  if (text === null) {
    return status(413);
  }
  const violations = parseCspReport(request.headers.get("Content-Type") ?? "", text);
  if (!violations) {
    return status(400);
  }
  for (const violation of violations) {
    logCspViolation(violation);
  }
  return status(204);
}
