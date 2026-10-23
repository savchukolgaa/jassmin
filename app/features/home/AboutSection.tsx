import { RichText } from "~/components/ui/RichText";
import type { HomePageView } from "~/lib/home";
import { Eyebrow } from "./Eyebrow";

type AboutSectionProps = { about: HomePageView["about"] };

/** Brand story from Strapi; the header's "About us" link scrolls here (`/#about`). */
export function AboutSection({ about }: AboutSectionProps) {
  return (
    <section
      id="about"
      aria-labelledby="about-title"
      className="scroll-mt-20 bg-white py-16 md:py-24 dark:bg-gray-950"
    >
      <div className="container mx-auto max-w-3xl px-4">
        <Eyebrow>About us</Eyebrow>
        <h2
          id="about-title"
          className="mt-2 text-3xl font-extrabold tracking-tight text-gray-950 md:text-4xl dark:text-white"
        >
          {about.title}
        </h2>
        <RichText
          html={about.bodyHtml}
          className="mt-6 text-lg text-gray-700 [&_a]:text-primary-dark dark:text-gray-300"
        />
      </div>
    </section>
  );
}
