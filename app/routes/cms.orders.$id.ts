import { checkCmsSyncAuth, readJsonBody } from "~/.server/cms/sync-auth";
import { applyCmsOrderChange, pushToCms } from "~/.server/services/cms-sync";
import { deliverOrderStatusEmails } from "~/.server/services/orders";
import { parseOrderId } from "~/lib/checkout";
import { cmsOrderChangeSchema, toSyncIssues } from "~/lib/cms-sync";
import type { Route } from "./+types/cms.orders.$id";

// POST only, from Strapi's document middleware (#40) before it saves a status or payment change
// made in the Strapi admin. Answers 200 with the order as the app stored it (Strapi saves that),
// 422 with `{ error, … }` for a refused change (Strapi shows it and saves nothing), 404 for an
// unknown order id, 400 for a body that isn't JSON, and 401/503 from `checkCmsSyncAuth`.
export async function action({ request, params }: Route.ActionArgs) {
  const denied = checkCmsSyncAuth(request);
  if (denied) return denied;

  const orderId = parseOrderId(params.id);
  if (orderId === null) {
    return Response.json({ error: "unknown-order" }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  const parsed = cmsOrderChangeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-input", issues: toSyncIssues(parsed.error) },
      { status: 422 },
    );
  }

  const result = await applyCmsOrderChange(orderId, parsed.data);
  if (!result.ok) {
    const { ok: _ok, ...error } = result;
    return Response.json(error, { status: error.error === "unknown-order" ? 404 : 422 });
  }
  // A cancellation queued its products' restored stock for Strapi; never rejects.
  void pushToCms();
  // The order status emails (#138) the change queued; the retry job sends what fails.
  if (result.emailsQueued) {
    void deliverOrderStatusEmails(orderId);
  }
  return Response.json(result.order);
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
