import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import type { ContactActionResult } from "~/lib/contact";
import type { HomePageView } from "~/lib/home";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { formatPrice } from "~/lib/money";
import type { ProductSummary } from "~/lib/products";
import { HomePage } from "./HomePage";

const view: HomePageView = {
  contentLocale: "en",
  hero: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    ctaHref: "/en/popular",
    image: {
      url: "http://cms.test/uploads/hero.jpg",
      alt: "Jassmin perfume testers",
      width: 1200,
      height: 800,
      srcSet: "http://cms.test/uploads/small_hero.jpg 500w, http://cms.test/uploads/hero.jpg 1200w",
    },
    eyebrow: "Tester set",
    subtitle: "Find the one worth a full bottle.",
    secondaryCta: { label: "See all perfumes", href: "/en/catalog/women" },
  },
  about: { title: "About Jassmin", bodyHtml: "<p>Our <strong>story</strong>.</p>", image: null },
  trioOffer: { price: "499.00", setSize: 3, volumeMl: 10 },
  trio: {
    families: ["квіткові", "деревні", "свіжі", "східні"],
    selected: [],
    gender: "women",
  },
  bestsellers: [],
  location: {
    address: "вул. Хрещатик, 1, Київ",
    openingHours: "Mon–Fri 10:00–20:00\nSat–Sun 11:00–18:00",
    mapEmbedUrl: "https://www.google.com/maps?q=Khreshchatyk&output=embed",
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=x",
    streetAddress: null,
    addressLocality: null,
    postalCode: null,
    latitude: null,
    longitude: null,
  },
  contacts: {
    locale: "en",
    phone: "+380 44 123 45 67",
    email: "hello@jassmin.ua",
    customerServiceHours: "Mon–Fri 9:00–18:00",
    legalName: null,
    socialLinks: [{ platform: "instagram", url: "https://www.instagram.com/jassmin" }],
  },
  seo: { title: "Jassmin", description: "Story", image: null },
};

const BESTSELLER: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "la-vie-est-belle",
  title: "La Vie Est Belle",
  brand: "Lancôme",
  gender: "women",
  packSize: 1,
  image: null,
  fragranceFamily: "гурманські",
  variants: [
    { id: "01a1652b-6e25-7d00-8000-000000000001", volumeMl: 10, price: "450.00", inStock: true },
    { id: "01a1652b-6e25-7d00-8000-000000000002", volumeMl: 50, price: "1890.00", inStock: true },
  ],
  minPrice: "450.00",
  hasPriceRange: true,
  volumes: [10, 50],
  inStock: true,
  defaultVariant: { id: "01a1652b-6e25-7d00-8000-000000000001", volumeMl: 10 },
};

let props: ComponentProps<typeof HomePage> = { view };

function TestHome() {
  return createElement(HomePage, props);
}

// `ContactForm` uses `useFetcher`, which needs a data router.
const Stub = createRoutesStub([{ path: "/", Component: TestHome }]);

function render(
  overrides: Partial<HomePageView> = {},
  actionData?: ContactActionResult,
  // In English by default, like the assertions.
  locale: Locale = "en",
) {
  props = { view: { ...view, ...overrides }, actionData };
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(Stub, { initialEntries: ["/"] })),
  );
}

/** The marquee band: from its dark wrapper up to the next section. */
function marquee(html: string): string {
  return html.match(/<div class="overflow-hidden bg-ink[\s\S]*?(?=<section)/)?.[0] ?? "";
}

describe("HomePage", () => {
  it("has exactly one h1 and never skips a heading level (#88)", () => {
    const levels = [...render().matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (const [i, level] of levels.entries()) {
      expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it("adds no lang attributes when the content is in the UI's language", () => {
    expect(render()).not.toContain(" lang=");
  });

  it("marks Ukrainian fallback content with lang=uk under the English UI", () => {
    const html = render({ contentLocale: "uk", contacts: { ...view.contacts, locale: "uk" } });

    expect(html).toMatch(/<div lang="uk"[^>]*>.*?<h1[^>]*id="hero-title"/s);
    expect(html).toMatch(/<h2[^>]*id="about-title"[^>]*lang="uk"/);
    expect(html).toMatch(/<div lang="uk"[^>]*><p>Our <strong>story/);
    expect(html).toMatch(/<dd class="[^"]*" lang="uk">вул. Хрещатик/);
    expect(html).toContain('<span lang="uk">Mon–Fri 9:00–18:00</span>');
    // UI copy around it stays in the page's language.
    expect(html).not.toMatch(/lang="uk"[^>]*>About us/);
  });

  it("renders every section of the HomeBoldPlus artboard in its order", () => {
    const html = render({ bestsellers: [BESTSELLER] });
    const positions = [
      'id="hero-title"',
      "animate-marquee",
      'id="how-it-works-title"',
      'id="trio"',
      'aria-label="Categories"',
      'id="bestsellers-title"',
      'id="about"',
      'id="location-title"',
      'id="contacts"',
    ].map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("speaks Ukrainian by default", () => {
    props = { view };
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { locale: "uk" }, createElement(Stub, { initialEntries: ["/"] })),
    );

    expect(html).toContain("Як це працює");
    expect(html).toContain("Зберіть своє тріо");
    expect(html).toContain("Жінкам · Чоловікам");
  });

  it("renders the hero headline, CTA link and responsive image", () => {
    const html = render();

    expect(html).toContain("<h1");
    expect(html).toContain("Order 3 Testers only for 499₴");
    expect(html).toMatch(/<a[^>]*href="\/en\/popular"[^>]*>Order Now<\/a>/);
    expect(html).toContain('alt="Jassmin perfume testers"');
    expect(html).toContain("small_hero.jpg 500w");
  });

  it("shows the hero image in the larger frame, with sizes to match (#72)", () => {
    const html = render();
    const image = html.match(/<img[^>]*alt="Jassmin perfume testers"[^>]*>/)?.[0] ?? "";

    expect(image).toContain('sizes="(min-width: 768px) 512px, 100vw"');
    expect(image).toMatch(/class="[^"]*h-112[^"]*md:h-152/);
    expect(html).toMatch(/class="relative mx-auto w-full max-w-lg min-w-0 flex-\[2_1_24rem\]"/);
  });

  it("renders the hero eyebrow, subtitle, second CTA and floating chip", () => {
    const html = render();

    expect(html).toContain("Tester set");
    expect(html).toContain("Find the one worth a full bottle.");
    expect(html).toMatch(/<a[^>]*href="\/en\/catalog\/women"[^>]*>See all perfumes<\/a>/);
    expect(html).toContain("Women · Men");
    expect(html).not.toMatch(/unisex/i);
  });

  it("leaves out the optional hero parts that aren't set", () => {
    const html = render({
      hero: { ...view.hero, eyebrow: null, subtitle: null, secondaryCta: null },
    });

    expect(html).not.toContain("Tester set");
    expect(html).not.toContain("See all perfumes");
  });

  it("shows the trio price on the hero badge, with a sentence for screen readers", () => {
    const html = render();

    expect(html).toContain("animate-badge");
    expect(html).toContain(`Only ${formatPrice("499.00", "en")} for 3 testers`);
  });

  it("hides the price badge without a live trio offer", () => {
    const html = render({ trioOffer: null });

    expect(html).not.toContain("animate-badge");
    expect(html).not.toContain("Only ");
  });

  it("scrolls the trio offer and free delivery in a slim marquee hidden from screen readers", () => {
    const band = marquee(render());
    const trio = `Order 3 testers only for ${formatPrice("499.00", "en")}`;
    const delivery = `Free delivery from ${formatPrice(FREE_SHIPPING_THRESHOLD, "en")}`;

    expect(band).toMatch(/^<div class="overflow-hidden bg-ink py-2 text-white">/);
    expect(band).toMatch(/<div aria-hidden="true" class="animate-marquee marquee-pause[^"]*"/);
    expect(band).toContain("text-base");
    expect(band).toContain("md:text-lg");
    // Repeated to fill wide screens, in both halves of the seamless loop.
    expect(band.match(new RegExp(`<span>${trio}</span>`, "g"))).toHaveLength(8);
    expect(band.match(new RegExp(`<span>${delivery}</span>`, "g"))).toHaveLength(8);
    expect(band.indexOf(trio)).toBeLessThan(band.indexOf(delivery));
  });

  it("shows no fragrance families in the marquee (#72)", () => {
    const html = render();
    const band = marquee(html);

    // The trio builder still offers them.
    expect(html).toContain("Woody");
    for (const family of ["Floral", "Woody", "Fresh", "Oriental"]) {
      expect(band).not.toContain(family);
    }
  });

  it("drops the trio item without a live rule but keeps free delivery", () => {
    const band = marquee(render({ trioOffer: null }));

    expect(band).toContain("animate-marquee");
    expect(band).not.toContain("Order 3 testers");
    expect(band).toContain("Free delivery from");
  });

  it("shows free delivery in Ukrainian", () => {
    const band = marquee(render({}, undefined, "uk"));

    expect(band).toContain(
      `Безкоштовна доставка від ${formatPrice(FREE_SHIPPING_THRESHOLD, "uk")}`,
    );
  });

  it("explains the trio in three steps with its live price", () => {
    const html = render();

    expect(html).toContain('id="how-it-works-title"');
    expect(html).toContain(`Pay ${formatPrice("499.00", "en")}`);
    expect(render({ trioOffer: null })).not.toContain('id="how-it-works-title"');
  });

  it("links the category tiles to the women's and men's catalogs only", () => {
    const html = render();
    const nav = html.match(/<nav aria-label="Categories".*?<\/nav>/s)?.[0] ?? "";

    expect(nav.match(/href="[^"]*"/g)).toEqual([
      'href="/en/catalog/women"',
      'href="/en/catalog/men"',
    ]);
    expect(nav).toContain(">Women<");
    expect(nav).toContain(">Men<");
  });

  it("lists the bestsellers as compact cards with quick add and a link to the catalog", () => {
    const html = render({ bestsellers: [BESTSELLER] });
    const section = html.match(/<section aria-labelledby="bestsellers-title".*?<\/section>/s)?.[0];

    expect(section).toContain(">Bestsellers</h2>");
    expect(section).toMatch(
      /<a[^>]*href="\/en\/catalog\/women"[^>]*>View all<span class="sr-only">: Women[^<]*<\/span><span aria-hidden="true"> →<\/span><\/a>/,
    );
    expect(section).toMatch(/<h3[^>]*><a[^>]*>La Vie Est Belle<\/a><\/h3>/);
    expect(section).toContain("quick-add");
    expect(render()).not.toContain('id="bestsellers-title"');
  });

  it("describes the hero and store photos in the visitor's language when Strapi's alt is blank (#88)", () => {
    const image = {
      url: "http://cms.test/uploads/a.jpg",
      alt: "",
      width: 1,
      height: 1,
      srcSet: null,
    };
    const html = render({
      hero: { ...view.hero, image },
      about: { ...view.about, image },
    });

    expect(html).toContain('alt="Perfume bottles at Jassmin"');
    expect(html).toContain('alt="The Jassmin perfume store"');
    expect(html).not.toContain('alt=""');
  });

  it("shows the about store photo, or a decorative frame without one", () => {
    const image = {
      url: "http://cms.test/uploads/store.jpg",
      alt: "Jassmin store",
      width: 1200,
      height: 800,
      srcSet: null,
    };
    const html = render({ about: { ...view.about, image } });

    expect(html).toMatch(
      /<img[^>]*src="http:\/\/cms\.test\/uploads\/store\.jpg"[^>]*alt="Jassmin store"/,
    );
    expect(render()).not.toContain("store.jpg");
    // The larger frame from #72, with sizes to match.
    const photo = html.match(/<img[^>]*alt="Jassmin store"[^>]*>/)?.[0] ?? "";
    expect(photo).toContain('sizes="(min-width: 768px) 640px, 100vw"');
    expect(photo).toMatch(/class="[^"]*h-96[^"]*flex-\[1_1_28rem\][^"]*md:h-136/);
  });

  it("puts the address and hours on a deep-pink card with a directions link", () => {
    const html = render();

    expect(html).toMatch(
      /<div class="[^"]*bg-primary[^"]*"><p class="[^"]*text-white[^"]*">Location<\/p>/,
    );
    expect(html).toContain("Come smell them in person");
    expect(html).toMatch(
      /<a href="https:\/\/www\.google\.com\/maps\/search[^"]*"[^>]*>Get directions<\/a>/,
    );
  });

  it("renders the sanitized about body as HTML", () => {
    expect(render()).toContain("<p>Our <strong>story</strong>.</p>");
  });

  it("renders the contact details as links", () => {
    const html = render();

    expect(html).toContain('href="tel:+380441234567"');
    expect(html).toContain('href="mailto:hello@jassmin.ua"');
    expect(html).toMatch(/href="https:\/\/www\.instagram\.com\/jassmin"[^>]*>Instagram<\/a>/);
  });

  it("embeds the map only when there is a safe map URL", () => {
    expect(render()).toContain("<iframe");
    expect(render({ location: { ...view.location, mapEmbedUrl: null } })).not.toContain("<iframe");
  });

  it("falls back to a placeholder without a hero image", () => {
    const html = render({ hero: { ...view.hero, image: null } });

    expect(html).not.toContain("<img");
  });

  it("renders a contact form that posts to the home route action", () => {
    const html = render();

    const form = html.match(/<form[^>]*method="post"[^>]*>/)?.[0];
    expect(form).toBeDefined();
    expect(form).toContain('action="/?index#contacts"');
    for (const name of ["name", "email", "message", "website"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('<label for="contact-email"');
  });

  it("shows field errors and keeps the submitted values after a failed submission", () => {
    const html = render(
      {},
      {
        status: "invalid",
        fieldErrors: { email: "contact.errors.emailInvalid" },
        values: { name: "Olha", email: "nope", message: "Hello there, Jassmin" },
      },
    );

    expect(html).toMatch(/id="contact-email"[^>]*aria-invalid="true"/);
    expect(html).toContain('aria-describedby="contact-email-error"');
    expect(html).toContain("Please enter a valid email address.");
    expect(html).toContain('value="Olha"');
    expect(html).toContain("Hello there, Jassmin</textarea>");
  });

  it("translates field errors that use the form's limits", () => {
    const values = { name: "Olha", email: "olha@example.com", message: "x" };
    const html = render(
      {},
      {
        status: "invalid",
        fieldErrors: { message: "contact.errors.messageTooShort" },
        values,
      },
    );

    expect(html).toContain("Your message needs at least 10 characters.");
  });

  it("confirms a sent message", () => {
    expect(render({}, { status: "success" })).toContain("Your message was sent");
  });

  it("explains rate limiting and delivery failures", () => {
    const values = { name: "Olha", email: "olha@example.com", message: "Hello there, Jassmin" };

    expect(render({}, { status: "rate_limited", retryAfterSeconds: 90, values })).toContain(
      "try again in 2 min",
    );
    expect(render({}, { status: "delivery_failed", values })).toContain("send your message");
  });
});
