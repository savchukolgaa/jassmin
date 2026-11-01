import { getSiteSettings } from "~/.server/cms/content";
import { getLocale } from "~/.server/locale";
import { type PrivacyContacts, PrivacyPolicy } from "~/features/privacy/PrivacyPolicy";
import { metaTranslator } from "~/lib/i18n";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/privacy";

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    { title: t("meta.title", { page: t("privacy.title") }), description: t("privacy.intro") },
  );
}

// The contacts and the ФОП's name come from the CMS. A legal page must stay readable when Strapi
// is down, so it then renders without them instead of failing with a 503.
export async function loader({
  request,
}: Route.LoaderArgs): Promise<{ contacts: PrivacyContacts | null }> {
  try {
    const { legalName, email, phone } = await getSiteSettings(await getLocale(request));
    return { contacts: { legalName, email, phone } };
  } catch (error: unknown) {
    console.error("Loading the privacy page contacts failed", error);
    return { contacts: null };
  }
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  return <PrivacyPolicy contacts={loaderData.contacts} />;
}
