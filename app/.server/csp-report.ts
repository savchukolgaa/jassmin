// CSP violation reports (#143): `routes/csp-report.ts` parses what browsers post and logs each
// violation as one `[csp]` line (see docs/security.md). Nothing is stored. Kept out of the route
// module because its top-level state (the rate limiter) must stay on the server.
import { cspReportUriBodySchema, reportingApiBodySchema } from "~/lib/csp-report.schema";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

/** Largest report body accepted, in bytes. */
export const MAX_CSP_REPORT_BYTES = 16 * 1024;

/** One violation, without query strings or fragments (they can carry tokens or emails). */
export interface CspViolation {
  directive: string;
  blockedUri: string;
  documentPath: string;
  sourceFile: string | undefined;
  line: number | undefined;
  disposition: string | undefined;
}

// Reports per client IP per minute. One page with a broken policy sends a few; a flood is cut
// off. In process memory on purpose: a report flood mustn't turn into database writes.
const globalForLimiter = globalThis as { __jassminCspReportLimiter?: RateLimiter };
globalForLimiter.__jassminCspReportLimiter ??= createRateLimiter({ limit: 30, windowMs: 60_000 });
export const cspReportLimiter: RateLimiter = globalForLimiter.__jassminCspReportLimiter;

/**
 * A URL without its query and fragment. Keywords like `inline` or `eval` stay as they are, and
 * anything that isn't a URL is cut at the first `?` or `#`.
 */
export function stripQuery(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin + url.pathname
      : url.protocol;
  } catch {
    return value.split(/[?#]/)[0] ?? "";
  }
}

function pathOf(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).pathname;
  } catch {
    return stripQuery(value);
  }
}

/** The violations in a report body, or `null` when it isn't a CSP report in either format. */
export function parseCspReport(contentType: string, text: string): CspViolation[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  if (contentType.startsWith("application/reports+json")) {
    const parsed = reportingApiBodySchema.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data.flatMap((report) =>
      report.type === "csp-violation" && report.body
        ? [
            {
              directive: report.body.effectiveDirective ?? "",
              blockedUri: stripQuery(report.body.blockedURL ?? ""),
              documentPath: pathOf(report.body.documentURL),
              sourceFile: report.body.sourceFile ? stripQuery(report.body.sourceFile) : undefined,
              line: report.body.lineNumber ?? undefined,
              disposition: report.body.disposition,
            },
          ]
        : [],
    );
  }

  const parsed = cspReportUriBodySchema.safeParse(json);
  if (!parsed.success) return null;
  const report = parsed.data["csp-report"];
  return [
    {
      directive: report["effective-directive"] ?? report["violated-directive"] ?? "",
      blockedUri: stripQuery(report["blocked-uri"] ?? ""),
      documentPath: pathOf(report["document-uri"]),
      sourceFile: report["source-file"] ? stripQuery(report["source-file"]) : undefined,
      line: report["line-number"],
      disposition: report.disposition,
    },
  ];
}

/** Logs one violation as a single `[csp]` line. */
export function logCspViolation(violation: CspViolation): void {
  console.warn("[csp]", violation);
}
