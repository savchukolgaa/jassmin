import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { type EntryContext, RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { nonceContext } from "~/.server/security-headers";
import { useNonce } from "~/lib/nonce";

// The real `ServerRouter` needs a whole server build; this stand-in shows the nonce it was given
// and the one `useNonce()` reads, plus a Suspense boundary so React streams its own inline script.
vi.mock("react-router", async (importOriginal) => {
  const { Suspense, use } = await import("react");
  const pending = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 10));
  function Late() {
    return createElement("p", null, use(pending));
  }
  function Inline() {
    return createElement("script", { nonce: useNonce() }, "/* inline */");
  }
  return {
    ...(await importOriginal<typeof import("react-router")>()),
    ServerRouter: ({ nonce }: { nonce?: string }) =>
      createElement(
        "html",
        null,
        createElement(
          "body",
          { "data-router-nonce": nonce },
          createElement(Inline),
          createElement(Suspense, { fallback: "…" }, createElement(Late)),
        ),
      ),
  };
});

const { default: handleRequest } = await import("./entry.server");

async function render(nonce: string) {
  const context = new RouterContextProvider();
  context.set(nonceContext, nonce);
  const response = await handleRequest(
    new Request("http://localhost/"),
    200,
    new Headers(),
    { isSpaMode: false } as EntryContext,
    context,
  );
  return { response, html: await response.text() };
}

describe("entry.server handleRequest", () => {
  it("gives the request's nonce to the router, useNonce and React's streaming scripts", async () => {
    const { response, html } = await render("n0nce==");

    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(html).toContain('data-router-nonce="n0nce=="');
    expect(html).toContain('<script nonce="n0nce==">/* inline */</script>');
    // Every inline script, including the one React streams to reveal the Suspense boundary.
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(1);
    for (const script of scripts) {
      expect(script).toContain('nonce="n0nce=="');
    }
  });

  it("answers HEAD without a body", async () => {
    const context = new RouterContextProvider();
    const response = await handleRequest(
      new Request("http://localhost/", { method: "HEAD" }),
      200,
      new Headers(),
      { isSpaMode: false } as EntryContext,
      context,
    );
    expect(response.body).toBeNull();
  });
});

function NonceProbe() {
  return createElement("span", null, `[${useNonce()}]`);
}

describe("useNonce", () => {
  it("is empty outside the server render", () => {
    expect(renderToString(createElement(NonceProbe))).toBe("<span>[]</span>");
  });
});
