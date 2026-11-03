import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { CatalogGender } from "~/lib/catalog";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { formatPrice } from "~/lib/money";
import type { TrioOffer } from "~/lib/trio";
import { TrioBuilder } from "./TrioBuilder";

const families = ["квіткові", "деревні", "свіжі", "східні"];
const trioOffer: TrioOffer = { price: "499.00", setSize: 3, volumeMl: 10 };

let props: ComponentProps<typeof TrioBuilder> = {
  families,
  selected: [],
  gender: "women",
  trioOffer,
};

function TestTrio() {
  return createElement(TrioBuilder, props);
}

// `ButtonLink` needs a router.
const Stub = createRoutesStub([{ path: "/", Component: TestTrio }]);

function render(
  selected: string[],
  {
    offer = trioOffer,
    locale = "en",
    trioFamilies = families,
    gender = "women",
  }: {
    offer?: TrioOffer | null;
    locale?: Locale;
    trioFamilies?: string[];
    gender?: CatalogGender;
  } = {},
) {
  props = { families: trioFamilies, selected, gender, trioOffer: offer };
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(Stub, { initialEntries: ["/"] })),
  );
}

const checkedValues = (html: string) =>
  [...html.matchAll(/<input type="checkbox"[^>]*>/g)]
    .filter(([input]) => input.includes('checked=""'))
    .map(([input]) => input.match(/value="([^"]+)"/)?.[1]);

describe("TrioBuilder", () => {
  it("is a GET form back to the trio section, with one checkbox per family", () => {
    const html = render([]);

    const form = html.match(/<form[^>]*>/)?.[0];
    expect(form).toContain('action="/#trio"');
    expect(form).toContain('method="get"');
    expect(html.match(/<input type="checkbox"[^>]*name="family"/g)).toHaveLength(families.length);
    expect(html).toContain('<legend class="sr-only">Scent families</legend>');
    // Submits without JS; removed once hydrated.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Show my picks<\/button>/);
  });

  it("starts empty with three numbered slots and three to pick", () => {
    const html = render([]);

    expect(checkedValues(html)).toEqual([]);
    expect(html.match(/<span class="sr-only">Slot \d<\/span>/g)).toHaveLength(3);
    expect(html).toContain(
      '<p role="status" class="text-lg font-bold text-on-dark-muted">3 more to pick</p>',
    );
    expect(html).not.toContain('href="/en/popular');
  });

  it("fills a slot per picked family and counts down", () => {
    const html = render(["деревні"]);

    expect(checkedValues(html)).toEqual(["деревні"]);
    expect(html).toMatch(/animate-slot-pop[^>]*><span class="sr-only">Slot 1: <\/span>Woody/);
    expect(html).toContain("2 more to pick");
  });

  it("leads to the popular perfumes with all three families and the trio price", () => {
    const html = render(["квіткові", "свіжі", "деревні"]);
    const href = `/en/popular?${new URLSearchParams([
      ["gender", "women"],
      ["family", "квіткові"],
      ["family", "свіжі"],
      ["family", "деревні"],
    ])}`;

    expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`Show my trio · ${formatPrice("499.00", "en")} →`);
    // The standout `xl` size, as wide as the slot row (#110).
    const link = html.match(/<a[^>]*href="\/en\/popular[^>]*>/)?.[0] ?? "";
    expect(link.split(/[\s"]/)).toEqual(expect.arrayContaining(["min-h-16", "w-full"]));
    expect(html).not.toContain('role="status"');
    // Before hydration nothing is locked: without JS the server caps the picks.
    expect(html).not.toMatch(/<input type="checkbox"[^>]*disabled/);
  });

  it("has a Women / Men switch in the form, Women by default (#102)", () => {
    const html = render([]);
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    const radios = [...form.matchAll(/<input type="radio"[^>]*>/g)].map(([input]) => input);

    expect(form).toMatch(/<fieldset><legend class="sr-only">Who&#x27;s it for<\/legend>/);
    expect(radios).toHaveLength(2);
    expect(radios.every((input) => input.includes('name="gender"'))).toBe(true);
    expect(radios.map((input) => input.match(/value="(\w+)"/)?.[1])).toEqual(["women", "men"]);
    expect(radios.filter((input) => input.includes('checked=""'))).toEqual([
      expect.stringContaining('value="women"'),
    ]);
    expect(form).toContain(">Women</span>");
    expect(form).toContain(">Men</span>");
  });

  it("keeps the gender from the URL in the switch and the link (#102)", () => {
    const html = render(["квіткові", "свіжі", "деревні"], { gender: "men" });

    const checked = [...html.matchAll(/<input type="radio"[^>]*>/g)]
      .filter(([input]) => input.includes('checked=""'))
      .map(([input]) => input.match(/value="(\w+)"/)?.[1]);
    expect(checked).toEqual(["men"]);
    expect(html).toContain(
      `href="/en/popular?gender=men&amp;family=${encodeURIComponent("квіткові")}&amp;`,
    );
  });

  it("drops the price from the button without a live trio offer", () => {
    const html = render(["квіткові", "свіжі", "деревні"], { offer: null });

    expect(html).toContain("Show my picks →");
    expect(html).not.toContain("499");
  });

  it("speaks Ukrainian by default", () => {
    const html = render(["квіткові"], { locale: "uk" });

    expect(html).toContain("Зберіть своє тріо");
    expect(html).toContain("Оберіть ще 2");
    expect(html).toContain(">Жінки</span>");
    expect(html).toContain(">Чоловіки</span>");
  });

  it("renders nothing without families", () => {
    expect(render([], { trioFamilies: [] })).toBe("");
  });
});
