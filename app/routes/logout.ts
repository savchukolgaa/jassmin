import { redirect } from "react-router";
import { logout } from "~/.server/session";
import type { Route } from "./+types/logout";

// POST only, from the "Log out" button: a GET (a link, a prefetch) must never log anyone out.
export async function action({ request }: Route.ActionArgs) {
  return logout(request);
}

export function loader() {
  return redirect("/");
}
