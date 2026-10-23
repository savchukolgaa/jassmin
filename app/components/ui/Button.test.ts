import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Button, type ButtonProps } from "./Button";
import { ButtonLink } from "./ButtonLink";

const renderButton = (props: ButtonProps = {}) =>
  renderToStaticMarkup(createElement(Button, props, "Order Now"));

describe("Button", () => {
  it("renders a primary pill button with the brand shadow", () => {
    const html = renderButton();
    expect(html).toMatch(/^<button /);
    expect(html).toContain("bg-primary");
    expect(html).toContain("rounded-pill");
    expect(html).toContain("shadow-button");
    expect(html).toContain("Order Now");
  });

  it("keeps the native type so it submits inside a <Form>", () => {
    expect(renderButton()).not.toContain("type=");
  });

  it("passes native button props through", () => {
    const html = renderButton({ type: "submit", name: "intent", value: "checkout" });
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="intent"');
    expect(html).toContain('value="checkout"');
  });

  it("supports the disabled state", () => {
    const html = renderButton({ disabled: true });
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("aria-busy");
  });

  it("disables the button and shows a spinner while loading", () => {
    const html = renderButton({ loading: true });
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain("Order Now");
  });

  it("renders the dark, outline-light and ghost variants", () => {
    expect(renderButton({ variant: "dark" })).toContain("bg-ink");
    expect(renderButton({ variant: "outline-light" })).toContain("border-white");
    expect(renderButton({ variant: "ghost" })).not.toContain("bg-primary ");
  });

  it("appends a custom className", () => {
    expect(renderButton({ className: "w-full" })).toContain(" w-full");
  });
});

describe("ButtonLink", () => {
  it("renders a link styled as a button", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ButtonLink, { to: "/catalog", size: "lg" }, "Shop"),
      ),
    );
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/catalog"');
    expect(html).toContain("bg-primary");
    expect(html).toContain("min-h-14.5");
    expect(html).toContain("Shop");
  });
});
