import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckboxField, type CheckboxFieldProps } from "./CheckboxField";

const render = (props: Partial<CheckboxFieldProps> = {}) =>
  renderToStaticMarkup(
    createElement(CheckboxField, { name: "marketingOptIn", label: "Send me news", ...props }),
  );

describe("CheckboxField", () => {
  it("labels an unticked checkbox with its card", () => {
    const html = render();
    expect(html).toMatch(/^<label for="field-marketingOptIn"/);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="marketingOptIn"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Send me news");
    expect(html).not.toContain("aria-describedby");
  });

  it("describes the checkbox with its hint and keeps its state", () => {
    const html = render({ hint: "Unsubscribe any time", defaultChecked: true, id: "profile-mk" });
    expect(html).toContain('id="profile-mk"');
    expect(html).toContain('aria-describedby="profile-mk-hint"');
    expect(html).toContain('<span id="profile-mk-hint"');
    expect(html).toContain('checked=""');
  });
});
