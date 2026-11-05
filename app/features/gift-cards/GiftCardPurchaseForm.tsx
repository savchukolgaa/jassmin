import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { cn } from "~/lib/cn";
import { GIFT_CARD_AMOUNTS, type GiftCardAmount } from "~/lib/gift-cards";
import { type TextKey, useT } from "~/lib/i18n";

/** The buy form's fields, as the action names them. */
export type GiftCardPurchaseField = "amount" | "email" | "recipientEmail";

export interface GiftCardPurchaseFormProps {
  /** The logged-in buyer's email, to prefill. */
  prefillEmail: string | null;
  /** `false` when no card payment provider is configured: the form can't be sent. */
  cardAvailable: boolean;
  fieldErrors?: Partial<Record<GiftCardPurchaseField, TextKey>>;
  formError?: TextKey;
  /** Submitted values after an error; they win over the prefill. */
  values?: Partial<Record<GiftCardPurchaseField, string>>;
}

const DEFAULT_AMOUNT: GiftCardAmount = 1000;

/**
 * The gift card page's buy form (#125): the three amounts as radio tiles, the buyer's email and an
 * optional recipient's email. Card payment only; the action sends the buyer to the provider.
 */
export function GiftCardPurchaseForm({
  prefillEmail,
  cardAvailable,
  fieldErrors,
  formError,
  values,
}: GiftCardPurchaseFormProps) {
  const { t, formatPrice } = useT();
  const submitting = useNavigation().state === "submitting";
  const initial = GIFT_CARD_AMOUNTS.find((amount) => String(amount) === values?.amount);
  const [amount, setAmount] = useState<GiftCardAmount>(initial ?? DEFAULT_AMOUNT);
  const amountError = fieldErrors?.amount;

  return (
    <Form
      method="post"
      aria-labelledby="gift-card-form-heading"
      className="flex flex-col gap-6 rounded-card-lg border border-line bg-white p-6 md:p-8"
      noValidate
    >
      <h2 id="gift-card-form-heading" className="text-3xl font-bold tracking-[-0.01em] text-ink">
        {t("giftCards.form.heading")}
      </h2>
      {formError && (
        <p role="alert" className="rounded-card bg-blush px-4 py-3 font-bold text-primary-dark">
          {t(formError)}
        </p>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-extrabold text-ink">{t("giftCards.form.amount")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {GIFT_CARD_AMOUNTS.map((option) => {
            const id = `gift-card-amount-${option}`;
            return (
              <label
                key={option}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-2xl border-2 bg-white px-2 py-5 text-center",
                  "font-serif text-2xl font-bold text-ink md:text-3xl",
                  "has-checked:border-primary has-checked:bg-blush has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-primary",
                  amountError ? "border-red-700" : "border-gray-200",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name="amount"
                  value={option}
                  checked={amount === option}
                  onChange={() => setAmount(option)}
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? "gift-card-amount-error" : undefined}
                  className="sr-only"
                />
                {formatPrice(String(option))}
              </label>
            );
          })}
        </div>
        {amountError && (
          <p id="gift-card-amount-error" className="text-sm font-bold text-red-700">
            {t(amountError)}
          </p>
        )}
      </fieldset>
      <TextField
        name="email"
        type="email"
        label={t("giftCards.form.email")}
        hint={t("giftCards.form.emailHint")}
        autoComplete="email"
        defaultValue={values?.email ?? prefillEmail ?? undefined}
        error={fieldErrors?.email && t(fieldErrors.email)}
      />
      <TextField
        name="recipientEmail"
        type="email"
        label={t("giftCards.form.recipientEmail")}
        hint={t("giftCards.form.recipientEmailHint")}
        autoComplete="off"
        defaultValue={values?.recipientEmail}
        error={fieldErrors?.recipientEmail && t(fieldErrors.recipientEmail)}
      />
      {!cardAvailable && (
        <p role="status" className="rounded-card bg-card px-4 py-3 text-ink">
          {t("giftCards.unavailable")}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="rounded-full"
        loading={submitting}
        disabled={!cardAvailable}
      >
        {t("giftCards.form.submit", { amount: formatPrice(String(amount)) })}
      </Button>
    </Form>
  );
}
