import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeDependencyFolders } from "./remove-worktree.mjs";

describe("removeDependencyFolders", () => {
  let root;
  let store;
  let wt;

  // Junctions on Windows (no rights needed), directory symlinks elsewhere.
  const link = (target, path) => nodeFs.symlinkSync(target, path, "junction");

  beforeEach(() => {
    root = nodeFs.mkdtempSync(join(tmpdir(), "remove-worktree-"));
    store = join(root, "store", "react");
    wt = join(root, "wt");
    nodeFs.mkdirSync(store, { recursive: true });
    nodeFs.writeFileSync(join(store, "package.json"), "{}");
    for (const dir of ["node_modules", "cms/node_modules/@strapi", "app/routes"]) {
      nodeFs.mkdirSync(join(wt, dir), { recursive: true });
    }
    link(store, join(wt, "node_modules", "react"));
    link(store, join(wt, "cms", "node_modules", "@strapi", "strapi"));
    nodeFs.writeFileSync(join(wt, "app", "routes", "home.tsx"), "");
  });

  afterEach(() => {
    nodeFs.rmSync(root, { recursive: true, force: true });
  });

  it("deletes every node_modules without following links into the shared store", () => {
    expect(removeDependencyFolders(wt).sort()).toEqual(
      [join(wt, "cms", "node_modules"), join(wt, "node_modules")].sort(),
    );
    expect(nodeFs.existsSync(join(wt, "node_modules"))).toBe(false);
    expect(nodeFs.existsSync(join(wt, "cms", "node_modules"))).toBe(false);
    expect(nodeFs.readFileSync(join(store, "package.json"), "utf8")).toBe("{}");
    expect(nodeFs.existsSync(join(wt, "app", "routes", "home.tsx"))).toBe(true);
  });

  it("unlinks a node_modules that is itself a link and doesn't walk into linked folders", () => {
    const shared = join(root, "shared");
    nodeFs.mkdirSync(join(shared, "node_modules"), { recursive: true });
    nodeFs.rmSync(join(wt, "cms"), { recursive: true });
    nodeFs.rmSync(join(wt, "node_modules"), { recursive: true });
    link(store, join(wt, "node_modules"));
    link(shared, join(wt, "vendor"));

    expect(removeDependencyFolders(wt)).toEqual([join(wt, "node_modules")]);
    expect(nodeFs.existsSync(join(store, "package.json"))).toBe(true);
    expect(nodeFs.existsSync(join(shared, "node_modules"))).toBe(true);
  });
});
