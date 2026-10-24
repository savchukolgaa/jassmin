import { data, redirect } from "react-router";
import { clearAnalyticsSession, getVisitor, trackEvents } from "~/.server/analytics";
import { clearConsent, serializeConsent } from "~/.server/consent";
import { safeRedirect } from "~/lib/auth";
import { consentFormSchema } from "~/lib/consent";
import type { Route } from "./+types/consent";

export type ConsentActionResult = { ok: false; error: "invalid-consent" };

/**
 * The page the visitor accepted on, as a GET with their headers: the visit starts there, so its
 * landing page, UTM tags and (from the page's `document.referrer`) source come from it.
 */
function pageRequest(request: Request, path: string, referrer: string | undefined): Request {
  const headers = new Headers(request.headers);
  headers.delete("Referer");
  if (referrer) {
    headers.set("Referer", referrer);
  }
  return new Request(new URL(path, request.url), { headers });
}

/**
 * Starts the visit and records the page view that the banner's page would otherwise lose.
 * Analytics: never fails the request.
 */
async function startTrackedVisit(
  request: Request,
  path: string,
  referrer: string | undefined,
  headers: Headers,
): Promise<void> {
  try {
    const page = pageRequest(request, path, referrer);
    const visitor = await getVisitor(page);
    for (const cookie of visitor.headers.getSetCookie()) {
      headers.append("Set-Cookie", cookie);
    }
    await trackEvents(visitor, page, [{ type: "page_view", properties: { path } }]);
  } catch (error: unknown) {
    console.error("Starting the analytics visit failed", error);
  }
}

// POST only, from the cookie banner (`granted` / `denied`) and the footer's "Cookie settings"
// (`reset`, which shows the banner again). A plain form post that comes back to the same page,
// so it works without JS.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData().catch(() => new FormData());
  const parsed = consentFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Only a tampered form gets here: the banner only offers the supported answers.
    return data<ConsentActionResult>({ ok: false, error: "invalid-consent" }, { status: 400 });
  }
  const { consent, redirectTo, referrer } = parsed.data;
  const path = safeRedirect(redirectTo, "/");
  const headers = new Headers();

  if (consent === "reset") {
    headers.append("Set-Cookie", await clearConsent());
  } else {
    headers.append("Set-Cookie", await serializeConsent(consent));
    if (consent === "granted") {
      await startTrackedVisit(request, path, referrer, headers);
    } else {
      // The visitor id stays for the guest cart; the analytics session ends.
      headers.append("Set-Cookie", await clearAnalyticsSession());
    }
  }
  return redirect(path, { headers });
}

export function loader() {
  return redirect("/");
}
