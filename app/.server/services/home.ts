import type { HomePage, SiteSettings } from "~/lib/cms";
import type { HomePageView, HomeShopData } from "~/lib/home";
import { directionsUrl, safeMapEmbedUrl } from "~/lib/links";
import { renderMarkdown, toPlainText } from "../markdown";

const NO_SHOP_DATA: HomeShopData = {
  trioOffer: null,
  trioFamilies: [],
  selectedFamilies: [],
  bestsellers: [],
};

/** Prepares the Strapi home page, site settings and shop data for the home route. */
export function buildHomePageView(
  homePage: HomePage,
  siteSettings: SiteSettings,
  shop: HomeShopData = NO_SHOP_DATA,
): HomePageView {
  const { hero, about, location } = homePage;
  return {
    contentLocale: homePage.locale,
    hero,
    about: { title: about.title, bodyHtml: renderMarkdown(about.body), image: about.image },
    trioOffer: shop.trioOffer,
    trio: { families: shop.trioFamilies, selected: shop.selectedFamilies },
    bestsellers: shop.bestsellers,
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
