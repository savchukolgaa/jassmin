import { Form } from "react-router";
import { requireUser } from "~/.server/services/auth";
import { Button } from "~/components/ui/Button";
import type { Route } from "./+types/account";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My account — Jassmin" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { fullName: user.fullName };
}

// Orders come in #12; for now the page greets the user and lets them log out.
export default function Account({ loaderData }: Route.ComponentProps) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-semibold">My account</h1>
      <p className="mt-2 text-lg">Hi, {loaderData.fullName}!</p>
      <p className="mt-2 text-gray-600 dark:text-gray-400">Your orders will appear here soon.</p>
      <Form method="post" action="/logout" className="mt-6">
        <Button type="submit" variant="dark">
          Log out
        </Button>
      </Form>
    </main>
  );
}
