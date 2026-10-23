import { Form } from "react-router";
import { requireUser } from "~/.server/services/auth";
import { Button } from "~/components/ui/Button";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/account";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [{ title: t("meta.title", { page: t("account.title") }) }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { fullName: user.fullName };
}

// Orders come in #12; for now the page greets the user and lets them log out.
export default function Account({ loaderData }: Route.ComponentProps) {
  const { t } = useT();

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-semibold">{t("account.title")}</h1>
      <p className="mt-2 text-lg">{t("account.greeting", { name: loaderData.fullName })}</p>
      <p className="mt-2 text-gray-600 dark:text-gray-400">{t("account.ordersSoon")}</p>
      <Form method="post" action="/logout" className="mt-6">
        <Button type="submit" variant="dark">
          {t("account.logOut")}
        </Button>
      </Form>
    </main>
  );
}
