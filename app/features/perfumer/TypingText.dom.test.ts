// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TYPING_MS_PER_CHAR, TypingText } from "./TypingText";

function reducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Lets `chars` characters' timers run, one render at a time. */
async function type(chars: number) {
  for (let n = 0; n < chars; n++) {
    await act(async () => vi.advanceTimersByTime(TYPING_MS_PER_CHAR));
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TypingText (#164)", () => {
  it("reveals the text a character at a time, and goes on when more arrives", async () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { container, rerender } = render(createElement(TypingText, { text: "Ось." }));

    expect(container.textContent).toBe("");
    await type(2);
    expect(container.textContent).toBe("Ос");
    await type(10);
    expect(container.textContent).toBe("Ось.");

    rerender(createElement(TypingText, { text: "Ось. Ще." }));
    await type(10);
    expect(container.textContent).toBe("Ось. Ще.");
  });

  it("shows the text at once with reduced motion", () => {
    reducedMotion(true);
    const { container } = render(createElement(TypingText, { text: "Ось свіжі аромати." }));
    expect(container.textContent).toBe("Ось свіжі аромати.");
  });
});
