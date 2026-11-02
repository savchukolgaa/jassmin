import { data, type ShouldRevalidateFunctionArgs } from "react-router";
import { getHomePage, getSiteSettings } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { getLocale } from "~/.server/locale";
import { getClientIp } from "~/.server/rate-limit";
import { submitContactMessage } from "~/.server/services/contact";
import { buildHomePageView } from "~/.server/services/home";
import { getBestsellers, getTrioFamilies } from "~/.server/services/products";
import { getTesterTrioOffer } from "~/.server/services/trio";
import { JsonLd } from "~/components/JsonLd";
import { parseContactForm } from "~/features/home/contact-form.schema";
import { HomePage } from "~/features/home/HomePage";
import type { ContactActionResult } from "~/lib/contact";
import { metaTranslator, useT } from "~/lib/i18n";
import { pageOf } from "~/lib/paths";
import { errorMeta, seoMeta } from "~/lib/seo";
import { storeGraphLd } from "~/lib/structured-data";
import { parseTrioSearch } from "~/lib/trio";
import { useSiteUrl } from "~/lib/use-site-url";
import type { Route } from "./+types/home";

export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error || !loaderData) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  // The CMS title is the whole `<title>`, brand included.
  const { title, image } = loaderData.seo;
  return seoMeta(
    { matches, location },
    {
      title,
      description: loaderData.seo.description || t("home.defaultDescription"),
      image: image ? { url: image, alt: title } : null,
    },
  );
}

// Content is edited in Strapi (`home-page`, `site-settings`), in the visitor's language with a
// Ukrainian fallback; an outage becomes a 503 page. The tester-trio price, the trio builder's
// families and the bestsellers come from PostgreSQL (#64); `?family=` holds the trio picks when
// the builder was submitted without JS.
export async function loader({ request }: Route.LoaderArgs) {
  const locale = await getLocale(request);
  const [homePage, siteSettings, trioOffer, trioFamilies, bestsellers] = await Promise.all([
    getHomePage(locale).catch(cmsUnavailable),
    getSiteSettings(locale).catch(cmsUnavailable),
    getTesterTrioOffer(),
    getTrioFamilies(),
    getBestsellers(),
  ]);
  const selectedFamilies = parseTrioSearch(new URL(request.url).searchParams, trioFamilies);
  return buildHomePageView(homePage, siteSettings, {
    trioOffer,
    trioFamilies,
    selectedFamilies,
    bestsellers,
  });
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
    clientKey: getClientIp(request) ?? "anonymous",
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

// Sending the contact form or adding a bestseller to the cart doesn't change anything this page
// shows, so skip reloading it from Strapi (the layout still refreshes the cart count).
export function shouldRevalidate({
  formMethod,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (
    formMethod?.toUpperCase() === "POST" &&
    (pageOf(formAction) === "home" || pageOf(formAction) === "cart")
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { locale } = useT();
  const siteUrl = useSiteUrl();
  return (
    <>
      <JsonLd
        data={storeGraphLd({
          origin: siteUrl,
          locale,
          location: loaderData.location,
          contacts: loaderData.contacts,
          image: loaderData.hero.image?.url ?? null,
        })}
      />
      <HomePage view={loaderData} actionData={actionData} />
    </>
  );
}
