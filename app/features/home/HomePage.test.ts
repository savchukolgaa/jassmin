import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ContactActionResult } from "~/lib/contact";
import type { HomePageView } from "~/lib/home";
import { I18nProvider } from "~/lib/i18n";
import { HomePage } from "./HomePage";

const view: HomePageView = {
  hero: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    ctaHref: "/popular",
    image: {
      url: "http://cms.test/uploads/hero.jpg",
      alt: "Jassmin perfume testers",
      width: 1200,
      height: 800,
      srcSet: "http://cms.test/uploads/small_hero.jpg 500w, http://cms.test/uploads/hero.jpg 1200w",
    },
  },
  about: { title: "About Jassmin", bodyHtml: "<p>Our <strong>story</strong>.</p>" },
  location: {
    address: "вул. Хрещатик, 1, Київ",
    openingHours: "Mon–Fri 10:00–20:00\nSat–Sun 11:00–18:00",
    mapEmbedUrl: "https://www.google.com/maps?q=Khreshchatyk&output=embed",
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=x",
  },
  contacts: {
    locale: "uk",
    phone: "+380 44 123 45 67",
    email: "hello@jassmin.ua",
    customerServiceHours: "Mon–Fri 9:00–18:00",
    socialLinks: [{ platform: "instagram", url: "https://www.instagram.com/jassmin" }],
  },
  seo: { title: "Jassmin", description: "Story", image: null },
};

let props: ComponentProps<typeof HomePage> = { view };

function TestHome() {
  return createElement(HomePage, props);
}

// `ContactForm` uses `useFetcher`, which needs a data router.
const Stub = createRoutesStub([{ path: "/", Component: TestHome }]);

function render(overrides: Partial<HomePageView> = {}, actionData?: ContactActionResult) {
  props = { view: { ...view, ...overrides }, actionData };
  // In English, like the assertions.
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(Stub, { initialEntries: ["/"] })),
  );
}

describe("HomePage", () => {
  it("renders Hero, About Us, Location and Contacts in that order", () => {
    const html = render();
    const positions = ['id="hero-title"', 'id="about"', 'id="location-title"', 'id="contacts"'].map(
      (marker) => html.indexOf(marker),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("renders the hero headline, CTA link and responsive image", () => {
    const html = render();

    expect(html).toContain("<h1");
    expect(html).toContain("Order 3 Testers only for 499₴");
    expect(html).toMatch(/<a[^>]*href="\/popular"[^>]*>Order Now<\/a>/);
    expect(html).toContain('alt="Jassmin perfume testers"');
    expect(html).toContain("small_hero.jpg 500w");
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

    const form = html.match(/<form[^>]*>/)?.[0];
    expect(form).toContain('method="post"');
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
