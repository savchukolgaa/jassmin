import { Outlet } from "react-router";

/** Layout for every public page; admin pages (#14) use their own layout. */
export default function ShopLayout() {
  return <Outlet />;
}
