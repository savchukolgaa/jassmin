import type { HomePage, SiteSettings } from "~/lib/cms";
import type { HomePageView } from "~/lib/home";
import { directionsUrl, safeMapEmbedUrl } from "~/lib/links";
import { renderMarkdown, toPlainText } from "../markdown";

/** Prepares the Strapi home page and site settings for the home route. */
export function buildHomePageView(homePage: HomePage, siteSettings: SiteSettings): HomePageView {
  const { hero, about, location } = homePage;
  return {
    contentLocale: homePage.locale,
    hero,
    about: { title: about.title, bodyHtml: renderMarkdown(about.body) },
    location: {
      address: location.address,
      openingHours: location.openingHours,
      mapEmbedUrl: safeMapEmbedUrl(location.mapEmbedUrl),
      directionsUrl: directionsUrl(location.address),
    },
    contacts: siteSettings,
    seo: {
      title: `Jassmin — ${hero.headline}`,
      description: toPlainText(about.body),
      image: hero.image?.url ?? null,
    },
  };
}
