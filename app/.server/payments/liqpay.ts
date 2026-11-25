// LiqPay (#192), the shop's card payment provider: card, Apple Pay, Google Pay and Privat24 on
// LiqPay's hosted page, run by PrivatBank. See docs/payments.md.
//
// - The checkout is a redirect to `CHECKOUT_URL` with `data` (base64 JSON) and `signature`, built
//   locally with no API call.
// - The callback is a form POST of the same two fields to `server_url` (`/payments/callback`).
// - The signature is base64(SHA3-256(private key + data + private key)) for API version 7, matching
//   the worked example in LiqPay's checkout docs. LiqPay's older code samples still use SHA-1 with
//   the same layout, so a callback signed either way is accepted; both are checked in constant
//   time and both need the private key.
// - `sandbox` mode sends `sandbox: 1`: LiqPay takes test cards and moves no money.
// - `orderPrefix` goes in front of every `order_id`, so a reset development database or a staging
//   server can't send LiqPay an `order_id` it has seen before. Production leaves it empty.
import { createHash, timingSafeEqual } from "node:crypto";
import { fromKopiyky } from "~/lib/money";
import { liqPayCallbackSchema } from "./liqpay.schema";
import type { CheckoutRequest, ParsedCallback, PaymentOutcome, PaymentProvider } from "./provider";

/** LiqPay's hosted checkout. Its origin is allowed in the CSP's `form-action`. */
export const LIQPAY_CHECKOUT_URL = "https://www.liqpay.ua/api/3/checkout";

/** The LiqPay API version the checkout `data` is written for. */
export const LIQPAY_API_VERSION = 7;

export interface LiqPayConfig {
  publicKey: string;
  privateKey: string;
  sandbox: boolean;
  /** Put in front of each `order_id` and expected on every callback; empty in production. */
  orderPrefix?: string;
}

type Digest = "sha3-256" | "sha1";

/** LiqPay's signature of `data`: base64 of the digest of private key + data + private key. */
export function signLiqPay(privateKey: string, data: string, digest: Digest = "sha3-256"): string {
  return createHash(digest)
    .update(privateKey + data + privateKey)
    .digest("base64");
}

function sameString(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hasValidSignature(privateKey: string, data: string, signature: string): boolean {
  // Both are computed, so the time taken doesn't say which one matched.
  const sha3 = sameString(signLiqPay(privateKey, data, "sha3-256"), signature);
  const sha1 = sameString(signLiqPay(privateKey, data, "sha1"), signature);
  return sha3 || sha1;
}

function decode(data: string): unknown {
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

const PENDING_STATUSES = new Set(["processing", "prepared", "cash_wait", "hold_wait"]);

/**
 * What a LiqPay `status` means for the attempt. Only `success` (or `sandbox`, LiqPay's test-mode
 * success, while in sandbox mode) is ever a success. Unknown statuses are logged and pending.
 */
export function toLiqPayOutcome(status: string, { sandbox }: { sandbox: boolean }): PaymentOutcome {
  if (status === "success") return "success";
  if (status === "sandbox") {
    if (sandbox) return "success";
    console.warn("LiqPay sent a sandbox payment while the shop is in live mode; ignoring it");
    return "pending";
  }
  if (status === "failure" || status === "error" || status === "reversed") return "failure";
  if (PENDING_STATUSES.has(status) || status.startsWith("wait_") || status.endsWith("_verify")) {
    return "pending";
  }
  console.warn(`LiqPay sent an unknown payment status "${status}"; treating it as pending`);
  return "pending";
}

/** A LiqPay amount (a number) as an exact `numeric(10, 2)` string, or `null` if it isn't one. */
export function normaliseLiqPayAmount(amount: number): string | null {
  const kopiyky = Math.round(amount * 100);
  if (!Number.isSafeInteger(kopiyky) || kopiyky < 0 || Math.abs(amount * 100 - kopiyky) > 1e-6) {
    return null;
  }
  return fromKopiyky(kopiyky);
}

export function createLiqPay({
  publicKey,
  privateKey,
  sandbox,
  orderPrefix = "",
}: LiqPayConfig): PaymentProvider {
  function parse(form: FormData): ParsedCallback {
    const data = form.get("data");
    const signature = form.get("signature");
    if (typeof data !== "string" || typeof signature !== "string" || !data || !signature) {
      return { ok: false, error: "malformed" };
    }
    if (!hasValidSignature(privateKey, data, signature)) {
      return { ok: false, error: "invalid-signature" };
    }
    const parsed = liqPayCallbackSchema.safeParse(decode(data));
    if (!parsed.success) {
      return { ok: false, error: "malformed" };
    }
    const payload = parsed.data;
    const amount = normaliseLiqPayAmount(payload.amount);
    if (
      payload.public_key !== publicKey ||
      !payload.order_id.startsWith(orderPrefix) ||
      payload.order_id.length === orderPrefix.length ||
      amount === null
    ) {
      return { ok: false, error: "malformed" };
    }
    return {
      ok: true,
      event: {
        reference: payload.order_id.slice(orderPrefix.length),
        outcome: toLiqPayOutcome(payload.status, { sandbox }),
        amount,
        currency: payload.currency,
        providerPaymentId: payload.payment_id === undefined ? null : String(payload.payment_id),
        raw: { ...payload },
      },
    };
  }

  return {
    name: "liqpay",

    createCheckout(request: CheckoutRequest) {
      const payload = {
        version: LIQPAY_API_VERSION,
        public_key: publicKey,
        action: "pay",
        amount: Number(request.amount),
        currency: request.currency,
        description: request.description,
        order_id: orderPrefix + request.reference,
        result_url: request.resultUrl,
        server_url: request.callbackUrl,
        language: request.locale,
        ...(sandbox ? { sandbox: 1 } : {}),
      };
      const data = Buffer.from(JSON.stringify(payload)).toString("base64");
      const url = new URL(LIQPAY_CHECKOUT_URL);
      url.search = new URLSearchParams({
        data,
        signature: signLiqPay(privateKey, data),
      }).toString();
      return { redirectUrl: url.toString() };
    },

    parseCallback(form: FormData): ParsedCallback {
      try {
        return parse(form);
      } catch (error) {
        // A backstop: parsing never throws by design, but a callback must never crash the route.
        console.error("Could not parse a LiqPay callback", error);
        return { ok: false, error: "malformed" };
      }
    },
  };
}
