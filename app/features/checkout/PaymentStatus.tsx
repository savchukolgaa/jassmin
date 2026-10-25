import { Form, Link, useNavigation } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import type { PaymentView } from "~/lib/checkout";
import { cn } from "~/lib/cn";
import { type TextKey, useT } from "~/lib/i18n";

const STATES: Record<PaymentView, { message: TextKey; className: string }> = {
  paid: { message: "checkout.success.paymentPaid", className: "bg-success-bg text-success" },
  pending: { message: "checkout.success.paymentPending", className: "bg-card text-ink" },
  failed: { message: "checkout.success.paymentFailed", className: "bg-blush text-primary-dark" },
};

export interface PaymentStatusProps {
  orderId: number;
  payment: PaymentView;
}

/**
 * Where a card order's online payment stands on its success page (#44). An unpaid order gets a
 * button that starts a new attempt (a POST to `/checkout/pay/:orderId`); a pending one can also
 * be reloaded, for a provider whose callback arrives after the shopper is back.
 */
export function PaymentStatus({ orderId, payment }: PaymentStatusProps) {
  const { t } = useT();
  const navigation = useNavigation();
  const payAction = `/checkout/pay/${orderId}`;
  const submitting = navigation.state !== "idle" && navigation.formAction === payAction;
  const state = STATES[payment];

  return (
    <div role="status" className={cn("flex flex-col gap-3 rounded-card p-5", state.className)}>
      <p className="font-extrabold">{t(state.message)}</p>
      {payment !== "paid" && (
        <div className="flex flex-wrap items-center gap-4">
          <Form method="post" action={payAction}>
            <Button type="submit" loading={submitting}>
              {t(payment === "failed" ? "checkout.success.retry" : "checkout.success.pay")}
            </Button>
          </Form>
          {payment === "pending" && (
            <Link
              to={`/checkout/success/${orderId}`}
              className={cn("rounded font-bold underline", focusRing("onLight"))}
            >
              {t("checkout.success.refresh")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
