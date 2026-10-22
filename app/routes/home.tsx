import { getHomePage } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { getDatabaseInfo } from "~/.server/db/queries/health";
import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Jassmin" }, { name: "description", content: "Jassmin perfume store" }];
}

// Placeholder until the real home page (#7): proves the DB and the Strapi CMS are both wired up.
export async function loader() {
  const [{ serverTime, pgVersion }, homePage] = await Promise.all([
    getDatabaseInfo(),
    getHomePage().catch(cmsUnavailable),
  ]);
  return { serverTime: serverTime.toISOString(), pgVersion, headline: homePage.hero.headline };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-semibold">Jassmin — coming soon</h1>
      <p className="mt-2 text-lg">{loaderData.headline}</p>
      <dl className="mt-6 text-sm text-gray-600 dark:text-gray-400">
        <dt className="font-medium">Database time</dt>
        <dd>{loaderData.serverTime}</dd>
        <dt className="mt-2 font-medium">PostgreSQL</dt>
        <dd>{loaderData.pgVersion}</dd>
      </dl>
    </main>
  );
}
