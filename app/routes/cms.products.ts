import { checkCmsSyncAuth, readJsonBody } from "~/.server/cms/sync-auth";
import { getEnv } from "~/.server/env";
import { applyCmsProductChange } from "~/.server/services/cms-sync";
import { cmsProductChangeSchema, toSyncIssues } from "~/lib/cms-sync";
import type { Route } from "./+types/cms.products";

// POST only, from Strapi's document middleware (#40) before it saves a product edited in the
// Strapi admin. Answers 200 with the product as the app stored it (Strapi saves that), 422 with
// `{ error, … }` when the edit is refused (Strapi shows it and saves nothing), 400 for a body
// that isn't JSON, and 401/503 from `checkCmsSyncAuth`.
export async function action({ request }: Route.ActionArgs) {
  const denied = checkCmsSyncAuth(request);
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (body === undefined) {
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  const parsed = cmsProductChangeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-input", issues: toSyncIssues(parsed.error) },
      { status: 422 },
    );
  }

  const change = parsed.data;
  if (change.action !== "delete" && change.imageUrl) {
    // Strapi's uploads are relative to the CMS origin, like the images `cms/content.ts` serves.
    const base = getEnv().STRAPI_URL;
    change.imageUrl = new URL(change.imageUrl, base.endsWith("/") ? base : `${base}/`).toString();
  }
  const result = await applyCmsProductChange(change);
  if (!result.ok) {
    const { ok: _ok, ...error } = result;
    return Response.json(error, { status: 422 });
  }
  return Response.json(result.product);
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
