import { getSellerDetails } from "~/.server/legal";
import { getLocale } from "~/.server/locale";
import { Returns } from "~/features/legal/Returns";
import { metaTranslator } from "~/lib/i18n";
import type { SellerDetails } from "~/lib/legal";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/returns";

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("legal.returns.title") }),
      description: t("legal.returns.description"),
    },
  );
}

// Returns and exchanges (#190). The contacts for reporting a problem come from the CMS; when
// Strapi is down the page points to the home page's contacts instead of failing.
export async function loader({ request }: Route.LoaderArgs): Promise<{
  seller: SellerDetails | null;
}> {
  try {
    return { seller: await getSellerDetails(await getLocale(request)) };
  } catch (error: unknown) {
    console.error("Loading the contacts for the returns page failed", error);
    return { seller: null };
  }
}

export default function ReturnsPage({ loaderData }: Route.ComponentProps) {
  return <Returns seller={loaderData.seller} />;
}
