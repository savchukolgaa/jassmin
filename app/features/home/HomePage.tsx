import type { ContactActionResult } from "~/lib/contact";
import type { HomePageView } from "~/lib/home";
import { AboutSection } from "./AboutSection";
import { ContactForm } from "./ContactForm";
import { ContactsSection } from "./ContactsSection";
import { HeroSection } from "./HeroSection";
import { LocationSection } from "./LocationSection";

type HomePageProps = {
  view: HomePageView;
  /** Contact form result after a full-page (no-JS) submission. */
  actionData?: ContactActionResult;
};

/** The home page sections, in the order the issue specifies: Hero, About Us, Location, Contacts. */
export function HomePage({ view, actionData }: HomePageProps) {
  return (
    <main>
      <HeroSection hero={view.hero} contentLocale={view.contentLocale} />
      <AboutSection about={view.about} contentLocale={view.contentLocale} />
      <LocationSection location={view.location} contentLocale={view.contentLocale} />
      <ContactsSection contacts={view.contacts}>
        <ContactForm actionData={actionData} />
      </ContactsSection>
    </main>
  );
}
