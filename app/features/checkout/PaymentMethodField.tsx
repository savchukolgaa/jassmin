import { cn } from "~/lib/cn";
import { PAYMENT_METHODS, type PaymentMethod } from "~/lib/enums";
import { type TextKey, useT } from "~/lib/i18n";

const LABELS: Record<PaymentMethod, { label: TextKey; note: TextKey }> = {
  card: { label: "checkout.payment.card", note: "checkout.payment.cardNote" },
  cod: { label: "checkout.payment.cod", note: "checkout.payment.codNote" },
};

export interface PaymentMethodFieldProps {
  defaultValue?: string;
  error?: string;
}

/** The payment method radios (`card` / `cod`); the payment fieldset's legend labels the group. */
export function PaymentMethodField({ defaultValue = "cod", error }: PaymentMethodFieldProps) {
  const { t } = useT();
  const errorId = "field-paymentMethod-error";

  return (
    <div className="flex flex-col gap-3">
      {PAYMENT_METHODS.map((method) => {
        const id = `field-paymentMethod-${method}`;
        return (
          <label
            key={method}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer gap-3 rounded-2xl border-2 bg-white p-4",
              "has-checked:border-primary has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-primary-light",
              error ? "border-red-700" : "border-gray-200",
            )}
          >
            <input
              id={id}
              type="radio"
              name="paymentMethod"
              value={method}
              defaultChecked={defaultValue === method}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-note ${errorId}` : `${id}-note`}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-extrabold text-ink">{t(LABELS[method].label)}</span>
              <span id={`${id}-note`} className="text-sm text-muted">
                {t(LABELS[method].note)}
              </span>
            </span>
          </label>
        );
      })}
      {error && (
        <span id={errorId} className="text-sm font-bold text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
