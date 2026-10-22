import { describe, expect, it } from "vitest";
import { formatCartCount } from "./header";

describe("formatCartCount", () => {
  it("is empty for an empty cart", () => {
    expect(formatCartCount(0)).toBe("");
  });

  it("shows the count", () => {
    expect(formatCartCount(1)).toBe("1");
    expect(formatCartCount(99)).toBe("99");
  });

  it("caps the count at 99+", () => {
    expect(formatCartCount(100)).toBe("99+");
  });
});
