import { getHomePage, getSiteSettings } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { buildHomePageView } from "~/.server/services/home";
import { HomePage } from "~/features/home/HomePage";
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

export default function Home({ loaderData }: Route.ComponentProps) {
  return <HomePage view={loaderData} />;
}
