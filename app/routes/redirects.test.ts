import { describe, expect, it } from "vitest";
import { action, loader } from "./redirects";

type LoaderArgs = Parameters<typeof loader>[0];

function load(path: string): Response {
  return loader({ request: new Request(`http://localhost${path}`) } as LoaderArgs) as Response;
}

function expectNotFound(run: () => unknown) {
  expect(run).toThrow(expect.objectContaining({ init: { status: 404 } }));
}

describe("redirects loader", () => {
  it.each([
    ["/catalog/women", "/katalog/zhinochi"],
    ["/catalog/men?page=2", "/katalog/cholovichi?page=2"],
    ["/products/bleu-de-chanel", "/parfumy/bleu-de-chanel"],
    ["/cart", "/koshyk"],
    ["/checkout/success/12", "/oformlennia/uspikh/12"],
    ["/account/profile", "/kabinet/profil"],
    ["/privacy", "/konfidentsiinist"],
    ["/login?redirectTo=%2Faccount", "/vkhid?redirectTo=%2Faccount"],
    ["/uk/koshyk", "/koshyk"],
    ["/uk", "/"],
    ["/en/koshyk", "/en/cart"],
  ])("sends %s to %s with a 301", (from, to) => {
    const response = load(from);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(to);
  });

  it.each(["/en/nope", "/nope", "/catalog/kids", "/uk/nope"])("answers 404 for %s", (path) => {
    expectNotFound(() => load(path));
  });

  it("answers 404 to a POST", () => {
    expectNotFound(() => action());
  });
});
