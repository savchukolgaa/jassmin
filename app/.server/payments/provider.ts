// The seam between card payments (#44) and whoever takes the money. Checkout, the callback route
// and the success page only talk to a `PaymentProvider`; `getPaymentProvider` picks the one
// `PAYMENT_PROVIDER` names. Only the local simulator exists for now, so a real provider is one
// more implementation here plus a migration that extends `payments_provider_check`.
import type { PaymentProvider as PaymentProviderName } from "~/lib/enums";
import type { Locale } from "~/lib/i18n";
import type { Env } from "../env";
import { createSimulator } from "./simulator";

/** What a provider needs to show its hosted payment page for one attempt. */
export interface CheckoutRequest {
  /** The attempt's `payments.reference`, sent as the provider's order id. */
  reference: string;
  /** The order total as an exact decimal string, e.g. `"2450.00"`. */
  amount: string;
  currency: string;
  /** Shown to the shopper on the payment page. */
  description: string;
  /** Absolute URL the shopper's browser comes back to. */
  resultUrl: string;
  /** Absolute URL the provider POSTs its signed callback to. */
  callbackUrl: string;
  locale: Locale;
}

export type PaymentOutcome = "success" | "failure" | "pending";

/** A callback whose signature checked out. */
export interface PaymentEvent {
  reference: string;
  outcome: PaymentOutcome;
  amount: string;
  currency: string;
  /** The provider's own id for the payment, when it sends one. */
  providerPaymentId: string | null;
  /** The decoded payload, stored on the attempt as `last_callback`. */
  raw: Record<string, unknown>;
}

export type ParsedCallback =
  | { ok: true; event: PaymentEvent }
  | { ok: false; error: "invalid-signature" | "malformed" };

export interface PaymentProvider {
  name: PaymentProviderName;
  /** The hosted payment page to send the shopper to. Pure: no network call. */
  createCheckout(request: CheckoutRequest): { redirectUrl: string };
  /** Verifies and decodes a callback's form body. Never throws. */
  parseCallback(form: FormData): ParsedCallback;
}

/** The configured provider, or `null` when card payment is off (`PAYMENT_PROVIDER` unset). */
export function getPaymentProvider(
  env: Pick<Env, "PAYMENT_PROVIDER" | "SESSION_SECRET">,
): PaymentProvider | null {
  switch (env.PAYMENT_PROVIDER) {
    case "simulator":
      return createSimulator(env.SESSION_SECRET);
    case undefined:
      return null;
  }
}
