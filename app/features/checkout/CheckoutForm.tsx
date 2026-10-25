import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import type { CheckoutField, CheckoutPrefill } from "~/lib/checkout";
import { type TextKey, useT } from "~/lib/i18n";
import { PaymentMethodField } from "./PaymentMethodField";

export interface CheckoutFormProps {
  prefill: CheckoutPrefill | null;
  fieldErrors?: Partial<Record<CheckoutField, TextKey>>;
  /** Submitted values after an error; they win over the prefill. */
  values?: Partial<Record<CheckoutField, string>>;
  /** Whether card payment can be chosen (a payment provider is configured, #44). */
  cardAvailable?: boolean;
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-4 text-2xl font-extrabold tracking-[-0.03em] text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Contact, Nova Poshta delivery and payment. The submit button is disabled while the form is
 * submitting, so a double click can't post it twice (the server also places one order per cart).
 */
export function CheckoutForm({
  prefill,
  fieldErrors,
  values,
  cardAvailable = true,
}: CheckoutFormProps) {
  const { t } = useT();
  const submitting = useNavigation().state === "submitting";
  const error = (field: CheckoutField) => {
    const key = fieldErrors?.[field];
    return key && t(key);
  };
  const value = (field: CheckoutField, fallback?: string | null) =>
    values?.[field] ?? fallback ?? undefined;

  return (
    <Form method="post" aria-label={t("checkout.form")} className="flex flex-col gap-10" noValidate>
      <Section legend={t("checkout.sections.contact")}>
        <TextField
          name="fullName"
          label={t("checkout.fields.fullName")}
          autoComplete="name"
          defaultValue={value("fullName", prefill?.fullName)}
          error={error("fullName")}
        />
        <TextField
          name="email"
          label={t("checkout.fields.email")}
          type="email"
          autoComplete="email"
          defaultValue={value("email", prefill?.email)}
          error={error("email")}
        />
        <TextField
          name="phone"
          label={t("checkout.fields.phone")}
          type="tel"
          autoComplete="tel"
          placeholder="+380"
          hint={t("checkout.fields.phoneHint")}
          defaultValue={value("phone", prefill?.phone)}
          error={error("phone")}
        />
      </Section>
      <Section legend={t("checkout.sections.delivery")}>
        <TextField
          name="city"
          label={t("checkout.fields.city")}
          autoComplete="address-level2"
          defaultValue={value("city")}
          error={error("city")}
        />
        <TextField
          name="branch"
          label={t("checkout.fields.branch")}
          hint={t("checkout.fields.branchHint")}
          defaultValue={value("branch")}
          error={error("branch")}
        />
      </Section>
      <Section legend={t("checkout.sections.payment")}>
        <PaymentMethodField
          defaultValue={value("paymentMethod")}
          error={error("paymentMethod")}
          cardAvailable={cardAvailable}
        />
      </Section>
      <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
        {t("checkout.submit")}
      </Button>
    </Form>
  );
}
