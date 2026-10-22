import { getDatabaseInfo } from "~/.server/db/queries/health";
import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Jassmin" }, { name: "description", content: "Jassmin perfume store" }];
}

export async function loader() {
  const { serverTime, pgVersion } = await getDatabaseInfo();
  return { serverTime: serverTime.toISOString(), pgVersion };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-semibold">Jassmin — coming soon</h1>
      <dl className="mt-6 text-sm text-gray-600 dark:text-gray-400">
        <dt className="font-medium">Database time</dt>
        <dd>{loaderData.serverTime}</dd>
        <dt className="mt-2 font-medium">PostgreSQL</dt>
        <dd>{loaderData.pgVersion}</dd>
      </dl>
    </main>
  );
}
