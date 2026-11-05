// The bodies browsers post to `/csp-report` (#143), as zod schemas. Imported only by the route's
// action, server code and tests, so zod stays out of the client bundle (#96).
import { z } from "zod";

const text = z.string().max(4096);
const count = z.number().int().nonnegative();

/** `report-uri` (`Content-Type: application/csp-report`): one violation. */
export const cspReportUriBodySchema = z.object({
  "csp-report": z.object({
    "document-uri": text.optional(),
    "violated-directive": text.optional(),
    "effective-directive": text.optional(),
    "blocked-uri": text.optional(),
    "source-file": text.optional(),
    "line-number": count.optional(),
    disposition: text.optional(),
  }),
});

/** `report-to` (`Content-Type: application/reports+json`): a batch of reports of any type. */
export const reportingApiBodySchema = z
  .array(
    z.object({
      type: text,
      body: z
        .object({
          documentURL: text.optional(),
          effectiveDirective: text.optional(),
          blockedURL: text.optional(),
          sourceFile: text.optional(),
          lineNumber: count.nullish(),
          disposition: text.optional(),
        })
        .optional(),
    }),
  )
  .max(50);
