import { data, type ShouldRevalidateFunctionArgs } from "react-router";
import { getHomePage, getSiteSettings } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { clientKey } from "~/.server/rate-limit";
import { submitContactMessage } from "~/.server/services/contact";
import { buildHomePageView } from "~/.server/services/home";
import { parseContactForm } from "~/features/home/contact-form";
import { HomePage } from "~/features/home/HomePage";
import type { ContactActionResult } from "~/lib/contact";
import { DEFAULT_HOME_DESCRIPTION } from "~/lib/home";
import type { Route } from "./+types/home";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return [{ title: "Jassmin" }, { name: "description", content: DEFAULT_HOME_DESCRIPTION }];
  }
  const { title, description, image } = loaderData.seo;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(image ? [{ property: "og:image", content: image }] : []),
  ];
}

// Content is edited in Strapi (`home-page`, `site-settings`); an outage becomes a 503 page.
export async function loader() {
  const [homePage, siteSettings] = await Promise.all([
    getHomePage().catch(cmsUnavailable),
    getSiteSettings().catch(cmsUnavailable),
  ]);
  return buildHomePageView(homePage, siteSettings);
}

// The contact form. User mistakes come back as typed results (never thrown) so the form can show
// them, with or without client JS.
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData().catch(() => new FormData());
  const parsed = parseContactForm(formData);
  if (!parsed.ok) {
    const { fieldErrors, values } = parsed;
    return data<ContactActionResult>({ status: "invalid", fieldErrors, values }, { status: 400 });
  }

  const result = await submitContactMessage({
    message: parsed.data,
    honeypot: parsed.honeypot,
    clientKey: clientKey(request),
  });
  switch (result.status) {
    case "rate_limited":
      return data<ContactActionResult>(
        {
          status: "rate_limited",
          retryAfterSeconds: result.retryAfterSeconds,
          values: parsed.data,
        },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      );
    case "delivery_failed":
      return data<ContactActionResult>(
        { status: "delivery_failed", values: parsed.data },
        { status: 503 },
      );
    default:
      return data<ContactActionResult>({ status: "success" });
  }
}

// Sending the contact form doesn't change any CMS content, so skip reloading it from Strapi.
export function shouldRevalidate({
  formMethod,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod?.toUpperCase() === "POST" && formAction?.startsWith("/?index")) {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  return <HomePage view={loaderData} actionData={actionData} />;
}
