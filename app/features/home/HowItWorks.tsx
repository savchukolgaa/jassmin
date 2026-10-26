import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import type { TrioOffer } from "~/lib/trio";

/** Three numbered steps of the tester-trio offer; only shown while the offer is live. */
export function HowItWorks({ trioOffer }: { trioOffer: TrioOffer }) {
  const { t, formatPrice } = useT();
  const steps = [
    { title: t("home.howItWorks.pickTitle"), body: t("home.howItWorks.pickBody") },
    {
      title: t("home.howItWorks.payTitle", { price: formatPrice(trioOffer.price) }),
      body: t("home.howItWorks.payBody"),
    },
    { title: t("home.howItWorks.decideTitle"), body: t("home.howItWorks.decideBody") },
  ];

  return (
    <section aria-labelledby="how-it-works-title" className="reveal">
      <div className="container mx-auto px-4 pt-16 pb-10 md:pt-22">
        <h2
          id="how-it-works-title"
          className="mb-8 text-4xl leading-tight font-extrabold tracking-[-0.03em] text-ink md:text-5xl"
        >
          {t("home.howItWorks.title")}
        </h2>
        <ol className="grid gap-5 md:grid-cols-3">
          {steps.map((step, index) => {
            const dark = index === steps.length - 1;
            return (
              <li
                key={step.title}
                className={cn(
                  "step-hover flex flex-col gap-3 rounded-[1.75rem] p-8",
                  dark ? "bg-ink text-white" : "bg-blush text-ink",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-7xl leading-none font-extrabold tracking-[-0.05em]",
                    dark ? "text-primary-light" : "text-primary-dark",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-2xl font-extrabold">{step.title}</h3>
                <p className={cn("leading-relaxed", dark ? "text-on-dark-muted" : "text-muted")}>
                  {step.body}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
