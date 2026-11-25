// The seam between card payments (#44) and whoever takes the money. Checkout, the callback route
// and the success page only talk to a `PaymentProvider`; `getPaymentProvider` picks the one
// `PAYMENT_PROVIDER` names: the local simulator or LiqPay (#192). Another provider is one more
// implementation here plus a migration that extends `payments_provider_check`.
import type { PaymentProvider as PaymentProviderName } from "~/lib/enums";
import type { Locale } from "~/lib/i18n";
import { type Env, isLiqPaySandbox } from "../env";
import { createLiqPay } from "./liqpay";
import { createSimulator, type Simulator } from "./simulator";

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

/** What `getPaymentProvider` reads; the LiqPay keys are only needed when it's the provider. */
export type PaymentEnv = Pick<Env, "PAYMENT_PROVIDER" | "SESSION_SECRET"> &
  Partial<
    Pick<
      Env,
      | "NODE_ENV"
      | "LIQPAY_PUBLIC_KEY"
      | "LIQPAY_PRIVATE_KEY"
      | "LIQPAY_SANDBOX"
      | "LIQPAY_ORDER_PREFIX"
    >
  >;

/** The configured provider, or `null` when card payment is off (`PAYMENT_PROVIDER` unset). */
export function getPaymentProvider(env: PaymentEnv): PaymentProvider | null {
  switch (env.PAYMENT_PROVIDER) {
    case "simulator":
      return createSimulator(env.SESSION_SECRET);
    case "liqpay":
      if (!env.LIQPAY_PUBLIC_KEY || !env.LIQPAY_PRIVATE_KEY) {
        // `parseEnv` refuses this, so only a hand-built env gets here.
        throw new Error("PAYMENT_PROVIDER=liqpay needs LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY");
      }
      return createLiqPay({
        publicKey: env.LIQPAY_PUBLIC_KEY,
        privateKey: env.LIQPAY_PRIVATE_KEY,
        sandbox: isLiqPaySandbox(env),
        orderPrefix: env.LIQPAY_ORDER_PREFIX,
      });
    case undefined:
      return null;
  }
}

/**
 * The configured provider's name, or `null` when card payment is off: for copy that names the
 * provider (checkout, gift cards, privacy policy, #192) without building it.
 */
export function getCardPaymentProviderName(
  env: Pick<Env, "PAYMENT_PROVIDER">,
): PaymentProviderName | null {
  return env.PAYMENT_PROVIDER ?? null;
}

/** The simulator when it's the configured provider, for its hosted page; `null` otherwise. */
export function getSimulator(env: PaymentEnv): Simulator | null {
  return env.PAYMENT_PROVIDER === "simulator" ? createSimulator(env.SESSION_SECRET) : null;
}
