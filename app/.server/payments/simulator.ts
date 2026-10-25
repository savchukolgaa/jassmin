// A local stand-in for a payment provider (#44), shaped like LiqPay so a real one is a small swap:
// the hosted page gets base64 JSON `data` plus a `signature`, and the callback is a form POST of
// the same two fields. The page itself is `routes/payments.simulator.tsx`, which sends these
// callbacks over HTTP to `/payments/callback`. Development only: `parseEnv` refuses
// `PAYMENT_PROVIDER=simulator` in production.
//
// Signatures are base64 HMAC-SHA256 with a key derived from `SESSION_SECRET`, so there is no extra
// secret to configure and nothing signed here can pass for a session cookie or vice versa.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LOCALES } from "~/lib/i18n";
import type { CheckoutRequest, ParsedCallback, PaymentOutcome, PaymentProvider } from "./provider";

/** The path the simulator's hosted page is served at. */
export const SIMULATOR_PATH = "/payments/simulator";

const amountSchema = z.string().regex(/^\d+\.\d{2}$/);

/** What the hosted page is told about the attempt (snake_case, like LiqPay's fields). */
const checkoutPayloadSchema = z.object({
  reference: z.string().min(1),
  amount: amountSchema,
  currency: z.string().min(1),
  description: z.string(),
  result_url: z.url(),
  callback_url: z.url(),
  locale: z.enum(LOCALES),
});

export type SimulatorCheckout = z.infer<typeof checkoutPayloadSchema>;

const callbackPayloadSchema = z.object({
  reference: z.string().min(1),
  status: z.string(),
  amount: amountSchema,
  currency: z.string().min(1),
  payment_id: z.string().min(1),
});

/** What the simulator's buttons can make the "bank" answer. */
export type SimulatorOutcome = "success" | "failure";

export interface SignedPayload {
  data: string;
  signature: string;
}

export interface Simulator extends PaymentProvider {
  /** The hosted page's attempt, or `null` when `data` or `signature` was tampered with. */
  verifyCheckout(data: string, signature: string): SimulatorCheckout | null;
  /** The signed callback the "bank" sends for the attempt. */
  buildCallback(checkout: SimulatorCheckout, outcome: SimulatorOutcome): SignedPayload;
}

function deriveKey(sessionSecret: string): Buffer {
  return createHmac("sha256", sessionSecret).update("payment-simulator").digest();
}

function signWith(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64");
}

function signedPayload(key: Buffer, payload: Record<string, unknown>): SignedPayload {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64");
  return { data, signature: signWith(key, data) };
}

/** Constant-time check of `signature` against the one `data` should have. */
function hasValidSignature(key: Buffer, data: string, signature: string): boolean {
  const expected = Buffer.from(signWith(key, data));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The decoded JSON in `data`, or `undefined` when it isn't base64 JSON. */
function decode(data: string): unknown {
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

function toOutcome(status: string): PaymentOutcome {
  if (status === "success") return "success";
  if (status === "failure") return "failure";
  return "pending";
}

export function createSimulator(sessionSecret: string): Simulator {
  const key = deriveKey(sessionSecret);

  return {
    name: "simulator",

    createCheckout(request: CheckoutRequest) {
      const payload: SimulatorCheckout = {
        reference: request.reference,
        amount: request.amount,
        currency: request.currency,
        description: request.description,
        result_url: request.resultUrl,
        callback_url: request.callbackUrl,
        locale: request.locale,
      };
      const { data, signature } = signedPayload(key, payload);
      // Served by this app, so it lives next to the URL the shopper comes back to.
      const url = new URL(SIMULATOR_PATH, request.resultUrl);
      url.search = new URLSearchParams({ data, signature }).toString();
      return { redirectUrl: url.toString() };
    },

    parseCallback(form: FormData): ParsedCallback {
      const data = form.get("data");
      const signature = form.get("signature");
      if (typeof data !== "string" || typeof signature !== "string") {
        return { ok: false, error: "malformed" };
      }
      if (!hasValidSignature(key, data, signature)) {
        return { ok: false, error: "invalid-signature" };
      }
      const raw = decode(data);
      const parsed = callbackPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: "malformed" };
      }
      const payload = parsed.data;
      return {
        ok: true,
        event: {
          reference: payload.reference,
          outcome: toOutcome(payload.status),
          amount: payload.amount,
          currency: payload.currency,
          providerPaymentId: payload.payment_id,
          raw: { ...payload },
        },
      };
    },

    verifyCheckout(data: string, signature: string) {
      if (!hasValidSignature(key, data, signature)) {
        return null;
      }
      const parsed = checkoutPayloadSchema.safeParse(decode(data));
      return parsed.success ? parsed.data : null;
    },

    buildCallback(checkout: SimulatorCheckout, outcome: SimulatorOutcome) {
      return signedPayload(key, {
        reference: checkout.reference,
        status: outcome,
        amount: checkout.amount,
        currency: checkout.currency,
        payment_id: `sim_${randomUUID()}`,
      });
    },
  };
}
