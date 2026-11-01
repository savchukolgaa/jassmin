import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getEnv } from "~/.server/env";
import { getSimulator } from "~/.server/payments/provider";
import type { SimulatorCheckout, SimulatorOutcome } from "~/.server/payments/simulator";
import { Button } from "~/components/ui/Button";
import { safeRedirect } from "~/lib/auth";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/payments.simulator";

// The local payment simulator's hosted page (#44), development only: every request is a 404
// unless `PAYMENT_PROVIDER=simulator` (which `parseEnv` refuses in production). It plays the bank:
// its buttons POST a signed callback over HTTP to `/payments/callback`, exactly as a real provider
// would, then send the shopper back to the success page.

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [
    { title: t("meta.title", { page: t("payments.simulator.title") }) },
    { name: "robots", content: "noindex" },
  ];
}

function requireSimulator() {
  const simulator = getSimulator(getEnv());
  if (!simulator) {
    throw data(null, { status: 404 });
  }
  return simulator;
}

export function loader({ request }: Route.LoaderArgs) {
  const simulator = requireSimulator();
  const params = new URL(request.url).searchParams;
  const signed = { data: params.get("data") ?? "", signature: params.get("signature") ?? "" };
  const checkout = simulator.verifyCheckout(signed.data, signed.signature);
  if (!checkout) {
    throw data(null, { status: 400 });
  }
  const { reference, amount, description } = checkout;
  return { reference, amount, description, ...signed };
}

const OUTCOMES = ["success", "success-twice", "failure", "leave"] as const;

const simulatorFormSchema = z.object({
  outcome: z.enum(OUTCOMES),
  data: z.string().min(1),
  signature: z.string().min(1),
});

export type SimulatorActionResult = { ok: false; error: "invalid-form" | "invalid-checkout" };

/** The callbacks each button sends: the success-twice one repeats the same signed callback. */
const CALLBACKS: Record<(typeof OUTCOMES)[number], { outcome: SimulatorOutcome; times: number }> = {
  success: { outcome: "success", times: 1 },
  "success-twice": { outcome: "success", times: 2 },
  failure: { outcome: "failure", times: 1 },
  leave: { outcome: "failure", times: 0 },
};

/** The URL when it's on this site, so the simulator never posts or redirects anywhere else. */
function sameOrigin(url: string, request: Request): URL | null {
  const parsed = new URL(url);
  return parsed.origin === new URL(request.url).origin ? parsed : null;
}

async function sendCallback(checkout: SimulatorCheckout, body: URLSearchParams): Promise<void> {
  try {
    const response = await fetch(checkout.callback_url, { method: "POST", body });
    if (!response.ok) {
      console.error(`Payment simulator: callback for ${checkout.reference} got ${response.status}`);
    }
  } catch (error: unknown) {
    console.error(`Payment simulator: callback for ${checkout.reference} failed`, error);
  }
}

export async function action({ request }: Route.ActionArgs) {
  const simulator = requireSimulator();
  const formData = await request.formData().catch(() => new FormData());
  const parsed = simulatorFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data<SimulatorActionResult>({ ok: false, error: "invalid-form" }, { status: 400 });
  }
  const checkout = simulator.verifyCheckout(parsed.data.data, parsed.data.signature);
  const resultUrl = checkout && sameOrigin(checkout.result_url, request);
  if (!checkout || !resultUrl || !sameOrigin(checkout.callback_url, request)) {
    return data<SimulatorActionResult>({ ok: false, error: "invalid-checkout" }, { status: 400 });
  }

  const { outcome, times } = CALLBACKS[parsed.data.outcome];
  const body = new URLSearchParams({ ...simulator.buildCallback(checkout, outcome) });
  for (let i = 0; i < times; i++) {
    await sendCallback(checkout, body);
  }
  return redirect(safeRedirect(resultUrl.pathname, "/"));
}

export default function PaymentSimulator({ loaderData }: Route.ComponentProps) {
  const { t, formatPrice } = useT();
  const { reference, amount, description, data: signedData, signature } = loaderData;
  const buttons = [
    { outcome: "success", label: t("payments.simulator.pay"), variant: "primary" },
    { outcome: "success-twice", label: t("payments.simulator.payTwice"), variant: "ghost" },
    { outcome: "failure", label: t("payments.simulator.decline"), variant: "ghost" },
    { outcome: "leave", label: t("payments.simulator.leave"), variant: "ghost" },
  ] as const;

  return (
    <main className="min-h-screen bg-card px-4 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <p role="note" className="rounded-card bg-blush px-4 py-3 font-bold text-primary-dark">
          {t("payments.simulator.banner")}
        </p>
        <section className="flex flex-col gap-5 rounded-card bg-white p-6 ring-1 ring-line">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-[-0.01em] text-ink">
              {t("payments.simulator.heading")}
            </h1>
            <p className="text-body">{description}</p>
            <p className="text-sm text-muted">{t("payments.simulator.reference", { reference })}</p>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-extrabold text-muted">{t("payments.simulator.amount")}</span>
            <span className="font-serif text-2xl font-bold text-ink">{formatPrice(amount)}</span>
          </div>
          <div className="flex flex-col gap-3">
            {buttons.map((button) => (
              <Form key={button.outcome} method="post" className="flex">
                <input type="hidden" name="data" value={signedData} />
                <input type="hidden" name="signature" value={signature} />
                <Button
                  type="submit"
                  name="outcome"
                  value={button.outcome}
                  variant={button.variant}
                  size={button.outcome === "success" ? "lg" : "md"}
                  className="w-full"
                >
                  {button.label}
                </Button>
              </Form>
            ))}
          </div>
          <p className="text-sm text-muted">{t("payments.simulator.hint")}</p>
        </section>
      </div>
    </main>
  );
}
