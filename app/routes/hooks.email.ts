import { checkBearerSecret } from "~/.server/bearer-auth";
import { toEmailEvents } from "~/.server/email/webhook-brevo";
import { brevoWebhookSchema } from "~/.server/email/webhook-brevo.schema";
import { getEnv } from "~/.server/env";
import { applyEmailEvents } from "~/.server/services/email-webhook";
import type { Route } from "./+types/hooks.email";

// POST only, from the email provider (Brevo, #134) with bounces and spam complaints. Authenticated
// by `Authorization: Bearer <EMAIL_WEBHOOK_SECRET>` (401, or 503 when the app has none). Answers
// 400 for a body that isn't JSON, 422 for one that isn't a Brevo event, and 200 with what was
// recorded otherwise, also for events we ignore, so Brevo doesn't retry them.
export async function action({ request }: Route.ActionArgs) {
  const denied = checkBearerSecret(request, getEnv().EMAIL_WEBHOOK_SECRET);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) {
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  const parsed = brevoWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-input" }, { status: 422 });
  }

  const events = toEmailEvents(parsed.data);
  const result = await applyEmailEvents(events);
  return Response.json({ received: parsed.data.length, ...result });
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
