import { describe, expect, it } from "vitest";
import { type ButtonVariant, buttonClasses } from "./button-styles";

const classList = (className: string) => className.split(" ");

const allVariants: ButtonVariant[] = ["primary", "secondary", "ghost"];

describe("buttonClasses", () => {
  it("defaults to the primary variant with shadow-md and shadow-lg on hover", () => {
    const classes = classList(buttonClasses());
    expect(classes).toEqual(
      expect.arrayContaining(["bg-primary", "text-white", "shadow-md", "hover:shadow-lg"]),
    );
    expect(classes.some((c) => c.startsWith("transition"))).toBe(true);
  });

  it.each(allVariants)("gives the %s variant keyboard focus and disabled styles", (variant) => {
    const classes = classList(buttonClasses({ variant }));
    expect(classes).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-primary",
        "disabled:cursor-not-allowed",
        "disabled:opacity-60",
      ]),
    );
  });

  it("styles the secondary variant as an outlined button", () => {
    expect(classList(buttonClasses({ variant: "secondary" }))).toEqual(
      expect.arrayContaining(["border", "border-primary", "text-primary"]),
    );
  });

  it("styles the ghost variant without a background or shadow", () => {
    const classes = classList(buttonClasses({ variant: "ghost" }));
    expect(classes).toContain("text-primary");
    expect(classes).not.toContain("bg-primary");
    expect(classes).not.toContain("shadow-md");
  });

  it.each([
    ["sm", "h-9"],
    ["md", "h-11"],
    ["lg", "h-13"],
  ] as const)("maps size %s to %s", (size, height) => {
    expect(classList(buttonClasses({ size }))).toContain(height);
  });

  it("appends a custom className last", () => {
    expect(buttonClasses({ className: "w-full" }).endsWith(" w-full")).toBe(true);
  });
});
