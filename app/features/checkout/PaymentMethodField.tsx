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
  /** `false` when no card payment provider is configured (#44): the card option is disabled. */
  cardAvailable?: boolean;
}

/** The payment method radios (`card` / `cod`); the payment fieldset's legend labels the group. */
export function PaymentMethodField({
  defaultValue = "cod",
  error,
  cardAvailable = true,
}: PaymentMethodFieldProps) {
  const { t } = useT();
  const errorId = "field-paymentMethod-error";

  return (
    <div className="flex flex-col gap-3">
      {PAYMENT_METHODS.map((method) => {
        const id = `field-paymentMethod-${method}`;
        const disabled = method === "card" && !cardAvailable;
        return (
          <label
            key={method}
            htmlFor={id}
            className={cn(
              "flex gap-3 rounded-2xl border-2 bg-white p-4",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              "has-checked:border-primary has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-primary",
              error ? "border-red-700" : "border-gray-200",
            )}
          >
            <input
              id={id}
              type="radio"
              name="paymentMethod"
              value={method}
              defaultChecked={!disabled && defaultValue === method}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-note ${errorId}` : `${id}-note`}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-extrabold text-ink">{t(LABELS[method].label)}</span>
              <span id={`${id}-note`} className="text-sm text-muted">
                {t(disabled ? "checkout.payment.cardUnavailable" : LABELS[method].note)}
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
