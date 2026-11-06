import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/Button";
import { usePathFor, useT } from "~/lib/i18n";

/**
 * The cart page's offer to bring back the abandoned cart a reminder email was about (#139). A
 * plain form posting the `restore` intent: the loader only reads, the action writes.
 */
export function RestoreCartBanner({
  cartId,
  abandonedAt,
  itemCount,
}: {
  cartId: number;
  abandonedAt: Date | string;
  itemCount: number;
}) {
  const { t, formatDate } = useT();
  const path = usePathFor();
  const navigation = useNavigation();
  const submitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "restore";
  const date = formatDate(new Date(abandonedAt).toISOString());

  return (
    <section
      aria-labelledby="restore-cart-heading"
      className="mt-6 flex flex-col items-start gap-3 rounded-card-lg bg-blush p-6 md:p-8"
    >
      <h2 id="restore-cart-heading" className="text-2xl font-bold tracking-[-0.01em] text-ink">
        {t("cart.restore.heading", { date })}
      </h2>
      <p className="text-body">{t("cart.restore.body", { count: itemCount })}</p>
      <Form method="post" action={path("cart")} aria-label={t("cart.restore.form")}>
        <input type="hidden" name="intent" value="restore" />
        <input type="hidden" name="cartId" value={cartId} />
        <Button type="submit" loading={submitting}>
          {t("cart.restore.submit")}
        </Button>
      </Form>
    </section>
  );
}
