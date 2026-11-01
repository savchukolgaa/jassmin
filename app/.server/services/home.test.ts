import { describe, expect, it } from "vitest";
import type { HomePage, SiteSettings } from "~/lib/cms";
import { buildHomePageView } from "./home";

const homePage: HomePage = {
  locale: "uk",
  hero: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    ctaHref: "/popular",
    image: {
      url: "http://cms.test/uploads/hero.jpg",
      alt: "Testers",
      width: 1200,
      height: 800,
      srcSet: null,
    },
    eyebrow: null,
    subtitle: null,
    secondaryCta: null,
  },
  about: {
    title: "About Jassmin",
    body: "We are **Jassmin**.\n\n<script>alert(1)</script>",
    image: null,
  },
  location: {
    address: "вул. Хрещатик, 1, Київ",
    openingHours: "Mon–Fri 10:00–20:00",
    mapEmbedUrl: "https://www.google.com/maps?q=Khreshchatyk&output=embed",
    streetAddress: "1 Khreshchatyk St",
    addressLocality: "Kyiv",
    postalCode: "01001",
    latitude: 50.4501,
    longitude: 30.5234,
  },
};

const siteSettings: SiteSettings = {
  locale: "uk",
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
  customerServiceHours: null,
  legalName: null,
  socialLinks: [],
};

describe("buildHomePageView", () => {
  it("renders the about body to sanitized HTML", () => {
    const view = buildHomePageView(homePage, siteSettings);

    expect(view.about).toEqual({
      title: "About Jassmin",
      bodyHtml: "<p>We are <strong>Jassmin</strong>.</p>\n",
      image: null,
    });
  });

  it("adds the trio offer, the trio builder's families and picks, and the bestsellers", () => {
    const trioOffer = { price: "499.00", setSize: 3, volumeMl: 10 };
    const families = ["квіткові"];
    const view = buildHomePageView(homePage, siteSettings, {
      trioOffer,
      trioFamilies: families,
      selectedFamilies: ["квіткові"],
      bestsellers: [],
    });

    expect(view.trioOffer).toEqual(trioOffer);
    expect(view.trio).toEqual({ families, selected: ["квіткові"] });
    expect(view.bestsellers).toEqual([]);
  });

  it("has no trio offer, families or bestsellers without shop data", () => {
    const view = buildHomePageView(homePage, siteSettings);

    expect(view.trioOffer).toBeNull();
    expect(view.trio).toEqual({ families: [], selected: [] });
  });

  it("passes on the locale the home page copy was served in", () => {
    expect(buildHomePageView({ ...homePage, locale: "en" }, siteSettings).contentLocale).toBe("en");
    expect(buildHomePageView(homePage, siteSettings).contentLocale).toBe("uk");
  });

  it("keeps a Google Maps embed and adds a directions link", () => {
    const { location } = buildHomePageView(homePage, siteSettings);

    expect(location.mapEmbedUrl).toBe(homePage.location.mapEmbedUrl);
    expect(location.directionsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1/);
    expect(location).toMatchObject({
      streetAddress: "1 Khreshchatyk St",
      addressLocality: "Kyiv",
      postalCode: "01001",
      latitude: 50.4501,
      longitude: 30.5234,
    });
  });

  it("drops a map URL that isn't Google Maps", () => {
    const view = buildHomePageView(
      { ...homePage, location: { ...homePage.location, mapEmbedUrl: "https://evil.test/maps" } },
      siteSettings,
    );

    expect(view.location.mapEmbedUrl).toBeNull();
  });

  it("builds SEO fields from the hero and the about text", () => {
    const { seo } = buildHomePageView(homePage, siteSettings);

    expect(seo).toEqual({
      title: "Jassmin — Order 3 Testers only for 499₴",
      description: "We are Jassmin.",
      image: "http://cms.test/uploads/hero.jpg",
    });
  });

  it("leaves the description empty for the route's default, and has no image", () => {
    const { seo } = buildHomePageView(
      {
        ...homePage,
        hero: { ...homePage.hero, image: null },
        about: { title: "A", body: " ", image: null },
      },
      siteSettings,
    );

    expect(seo.description).toBe("");
    expect(seo.image).toBeNull();
  });
});
