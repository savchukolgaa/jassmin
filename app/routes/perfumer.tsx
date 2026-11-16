import { data } from "react-router";
import { isPerfumerEnabled } from "~/.server/ai/config";
import { metaTranslator } from "~/lib/i18n";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/perfumer";

// The AI perfumer chat (#163): `/parfumer`, `/en/perfumer`. A 404 while the engine (#162) is off.

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("perfumer.metaTitle") }),
      description: t("perfumer.metaDescription"),
    },
  );
}

/** A 404 unless `AI_BASE_URL` is set. */
function requirePerfumer() {
  if (!isPerfumerEnabled()) {
    throw data(null, { status: 404 });
  }
}

export function loader() {
  requirePerfumer();
  return {};
}

export default function PerfumerRoute() {
  return null;
}
