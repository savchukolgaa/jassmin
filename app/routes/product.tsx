import { data } from "react-router";
import { z } from "zod";
import { getProduct } from "~/.server/services/products";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/product";

const DESCRIPTION_LENGTH = 160;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return [{ title: "Jassmin" }];
  }
  const { product } = loaderData;
  return [
    { title: `${product.title} — ${product.brand} — Jassmin` },
    {
      name: "description",
      content: (product.description ?? product.title).slice(0, DESCRIPTION_LENGTH),
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = z.uuid().safeParse(params.id);
  const product = id.success ? await getProduct(id.data) : null;
  if (!product) {
    throw data(null, { status: 404 });
  }
  // #18: trackEvent(request, "product_view", { productId: product.id }).
  return { product };
}

export default function Product({ loaderData }: Route.ComponentProps) {
  return <PagePlaceholder title={loaderData.product.title} />;
}
