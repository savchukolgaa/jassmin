import { redirect } from "react-router";
import { pushToCms } from "~/.server/services/cms-sync";
import { handlePaymentCallback } from "~/.server/services/payments";
import type { Route } from "./+types/payments.callback";

// POST only, from the payment provider (#44), never from a browser: no session, cookies or
// consent are involved. A body that fails the signature check gets a 400 and changes nothing.
// Any verified callback gets a 200, also when it's ignored (a repeat, an unknown reference), so
// the provider stops retrying it.
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return new Response("Bad request", { status: 400 });
  }
  const result = await handlePaymentCallback(form);
  if (!result.ok) {
    return result.error === "unavailable"
      ? new Response("Not found", { status: 404 })
      : new Response("Bad request", { status: 400 });
  }
  if (result.result === "paid") {
    // The paid order was queued for Strapi (#40); not awaited and never rejects.
    void pushToCms();
  }
  return new Response("OK", { status: 200 });
}

export function loader() {
  return redirect("/");
}
