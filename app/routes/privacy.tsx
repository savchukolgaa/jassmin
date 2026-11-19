import { getAiProviderName, isPerfumerEnabled } from "~/.server/ai/config";
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
// is down, so it then renders without them instead of failing with a 503. `aiProvider` names
// where the AI perfumer's messages go, when that's a hosted provider (#167), and
// `perfumerEnabled` whether the perfumer (and its saved chats, #180) is on.
export async function loader({ request }: Route.LoaderArgs): Promise<{
  contacts: PrivacyContacts | null;
  aiProvider: string | null;
  perfumerEnabled: boolean;
}> {
  const aiProvider = getAiProviderName();
  const perfumerEnabled = isPerfumerEnabled();
  try {
    const { legalName, email, phone } = await getSiteSettings(await getLocale(request));
    return { contacts: { legalName, email, phone }, aiProvider, perfumerEnabled };
  } catch (error: unknown) {
    console.error("Loading the privacy page contacts failed", error);
    return { contacts: null, aiProvider, perfumerEnabled };
  }
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  return (
    <PrivacyPolicy
      contacts={loaderData.contacts}
      aiProvider={loaderData.aiProvider}
      perfumerEnabled={loaderData.perfumerEnabled}
    />
  );
}
