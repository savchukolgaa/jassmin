import { describe, expect, it } from "vitest";
import { en } from "./en";
import type { Dictionary } from "./types";
import { uk } from "./uk";

type Node = string | { [key: string]: Node };

function isPlural(node: { [key: string]: Node }): boolean {
  return typeof node.other === "string";
}

/** Every leaf path, with plural messages counted as one leaf. */
function leaves(node: Node, prefix = ""): string[] {
  if (typeof node === "string" || isPlural(node)) {
    return [prefix];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

function strings(node: Node): string[] {
  return typeof node === "string" ? [node] : Object.values(node).flatMap(strings);
}

function plurals(node: Node): { [key: string]: Node }[] {
  if (typeof node === "string") return [];
  return isPlural(node) ? [node] : Object.values(node).flatMap(plurals);
}

describe("dictionaries", () => {
  it("have the same keys in every locale", () => {
    expect(leaves(en).sort()).toEqual(leaves(uk).sort());
  });

  it("have no empty messages", () => {
    for (const message of [...strings(uk), ...strings(en)]) {
      expect(message.trim()).not.toBe("");
    }
  });

  it("give every Ukrainian plural all four forms", () => {
    for (const forms of plurals(uk)) {
      expect(Object.keys(forms).sort()).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("make a missing key a type error", () => {
    const { nav: _nav, ...withoutNav } = en;
    // @ts-expect-error `nav` is missing, so this isn't a Dictionary. `pnpm typecheck` fails if
    // the check ever stops catching it.
    const incomplete: Dictionary = withoutNav;
    expect(incomplete).not.toHaveProperty("nav");
  });
});
