import { Outlet } from "react-router";
import { getHeaderState } from "~/.server/services/header";
import { Header } from "~/components/layout/Header";
import type { Route } from "./+types/_shop";

// Runs on every navigation and after every action, so the header (e.g. the cart badge) stays fresh.
export async function loader({ request }: Route.LoaderArgs) {
  return getHeaderState(request);
}

/** Layout for every public page; admin pages (#14) use their own layout. */
export default function ShopLayout({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <Header {...loaderData} />
      <Outlet />
    </>
  );
}
