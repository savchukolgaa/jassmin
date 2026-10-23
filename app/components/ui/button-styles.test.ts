import { describe, expect, it } from "vitest";
import { type ButtonVariant, buttonClasses } from "./button-styles";

const classList = (className: string) => className.split(" ");

const allVariants: ButtonVariant[] = ["primary", "dark", "outline-light", "ghost"];

describe("buttonClasses", () => {
  it("defaults to the primary variant with the brand shadow", () => {
    const classes = classList(buttonClasses());
    expect(classes).toEqual(
      expect.arrayContaining([
        "bg-primary",
        "text-white",
        "shadow-button",
        "hover:bg-primary-dark",
        "hover:shadow-button-hover",
      ]),
    );
    expect(classes.some((c) => c.startsWith("transition"))).toBe(true);
  });

  it.each(allVariants)("makes the %s variant a bold pill", (variant) => {
    expect(classList(buttonClasses({ variant }))).toEqual(
      expect.arrayContaining(["rounded-pill", "font-extrabold"]),
    );
  });

  it.each(allVariants)("gives the %s variant keyboard focus and disabled styles", (variant) => {
    const classes = classList(buttonClasses({ variant }));
    expect(classes).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-3",
        "focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed",
        "disabled:opacity-60",
      ]),
    );
    expect(classes.some((c) => c.startsWith("focus-visible:outline-") && c.length > 25)).toBe(true);
  });

  it("only scales on hover when motion is allowed", () => {
    expect(classList(buttonClasses())).toContain("motion-safe:not-disabled:hover:scale-[1.03]");
  });

  it("styles the dark variant with ink and white text", () => {
    expect(classList(buttonClasses({ variant: "dark" }))).toEqual(
      expect.arrayContaining(["bg-ink", "text-white"]),
    );
  });

  it("styles the outline-light variant for pink surfaces", () => {
    expect(classList(buttonClasses({ variant: "outline-light" }))).toEqual(
      expect.arrayContaining([
        "border-2",
        "border-white",
        "text-white",
        "focus-visible:outline-white",
        // Inverts on hover: a translucent white overlay would drop white text below 4.5:1.
        "hover:bg-white",
        "hover:text-primary",
      ]),
    );
  });

  it("styles the ghost variant without a background or shadow", () => {
    const classes = classList(buttonClasses({ variant: "ghost" }));
    expect(classes).toContain("text-primary-dark");
    expect(classes).not.toContain("bg-primary");
    expect(classes).not.toContain("shadow-button");
  });

  it.each([
    ["sm", "min-h-11"],
    ["md", "min-h-13"],
    ["lg", "min-h-14.5"],
  ] as const)("maps size %s to %s", (size, height) => {
    expect(classList(buttonClasses({ size }))).toContain(height);
  });

  it("appends a custom className last", () => {
    expect(buttonClasses({ className: "w-full" }).endsWith(" w-full")).toBe(true);
  });
});
