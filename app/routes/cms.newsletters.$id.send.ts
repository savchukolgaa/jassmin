import { checkCmsSyncAuth, readJsonBody } from "~/.server/cms/sync-auth";
import { db } from "~/.server/db";
import { getEnv } from "~/.server/env";
import { pushToCms } from "~/.server/services/cms-sync";
import { getMailer } from "~/.server/services/mailer";
import { sendNewsletter, sendNewsletterTest } from "~/.server/services/newsletters";
import { toSyncIssues } from "~/lib/cms-sync";
import { cmsNewsletterSendSchema } from "~/lib/newsletter.schema";
import type { Route } from "./+types/cms.newsletters.$id.send";

/** Strapi's document ids are 24 lowercase letters and digits; this allows a little more. */
const DOCUMENT_ID = /^[a-z0-9]{10,64}$/;

const STATUS_BY_ERROR = {
  "already-sent": 409,
  "newsletter-slug-taken": 409,
  "another-sending": 409,
  "too-soon": 422,
  "no-recipients": 422,
  "test-suppressed": 422,
  "mail-not-configured": 503,
  "mail-failed": 502,
} as const;

// POST only, from Strapi when staff press "Send to subscribers" or "Send a test to me" on a
// newsletter (#181), with `CMS_SYNC_SECRET`. A send answers 200 with the newsletter's status and
// counts (Strapi stores them; the job's later pushes keep them current); a test answers 200 with
// how many emails went out. Refusals are `{ error, … }` with 409/422/502/503, an invalid body 422
// `invalid-newsletter`, a body that isn't JSON 400, and 401/503 from `checkCmsSyncAuth`.
export async function action({ request, params }: Route.ActionArgs) {
  const denied = checkCmsSyncAuth(request);
  if (denied) return denied;

  if (!DOCUMENT_ID.test(params.id)) {
    return Response.json({ error: "unknown-newsletter" }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  const parsed = cmsNewsletterSendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-newsletter", issues: toSyncIssues(parsed.error) },
      { status: 422 },
    );
  }

  const deps = { db, mailer: getMailer(), env: getEnv() };
  const input = parsed.data;
  if (input.mode === "test") {
    const result = await sendNewsletterTest(input.content, input.to, deps);
    if (!result.ok) {
      const { ok: _ok, ...error } = result;
      return Response.json(error, { status: STATUS_BY_ERROR[error.error] });
    }
    return Response.json({ sent: result.sent });
  }

  const result = await sendNewsletter(params.id, input.content, deps);
  if (!result.ok) {
    const { ok: _ok, ...error } = result;
    return Response.json(error, { status: STATUS_BY_ERROR[error.error] });
  }
  // The counts queued in the send's transaction; never rejects. The deliveries go out with the
  // next `pnpm db:send-newsletters` run, so the daily limit is counted in one place.
  void pushToCms();
  return Response.json(result.state);
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
