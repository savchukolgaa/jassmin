import type { HomePageView } from "~/lib/home";
import { AboutSection } from "./AboutSection";
import { ContactsSection } from "./ContactsSection";
import { HeroSection } from "./HeroSection";
import { LocationSection } from "./LocationSection";

type HomePageProps = { view: HomePageView };

/** The home page sections, in the order the issue specifies: Hero, About Us, Location, Contacts. */
export function HomePage({ view }: HomePageProps) {
  return (
    <main>
      <HeroSection hero={view.hero} />
      <AboutSection about={view.about} />
      <LocationSection location={view.location} />
      <ContactsSection contacts={view.contacts} />
    </main>
  );
}
