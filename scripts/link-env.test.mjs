import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkEnvFiles } from "./link-env.mjs";

function codeError(code) {
  return Object.assign(new Error(code), { code });
}

const throwing = (code) => () => {
  throw codeError(code);
};

describe("linkEnvFiles", () => {
  let root;
  let main;
  let wt;
  let messages;
  const log = (message) => messages.push(message);

  beforeEach(() => {
    root = nodeFs.mkdtempSync(join(tmpdir(), "link-env-"));
    main = join(root, "main");
    wt = join(root, "wt");
    for (const dir of [main, wt]) nodeFs.mkdirSync(join(dir, "cms"), { recursive: true });
    nodeFs.writeFileSync(join(main, ".env"), "APP=1\n");
    nodeFs.writeFileSync(join(main, "cms", ".env"), "CMS=1\n");
    messages = [];
  });

  afterEach(() => {
    nodeFs.rmSync(root, { recursive: true, force: true });
  });

  it("creates real symlinks when the platform allows them", (context) => {
    try {
      nodeFs.symlinkSync(join(main, ".env"), join(root, "probe"), "file");
    } catch {
      context.skip(); // e.g. Windows without Developer Mode
    }
    expect(linkEnvFiles(main, wt, { log })).toEqual([
      { file: ".env", result: "symlink" },
      { file: join("cms", ".env"), result: "symlink" },
    ]);
    expect(nodeFs.lstatSync(join(wt, ".env")).isSymbolicLink()).toBe(true);
    expect(nodeFs.readFileSync(join(wt, "cms", ".env"), "utf8")).toBe("CMS=1\n");
    expect(messages).toEqual([]);
  });

  it("falls back to a hard link that follows edits when symlinks aren't permitted", () => {
    const fs = { ...nodeFs, symlinkSync: throwing("EPERM") };

    expect(linkEnvFiles(main, wt, { log, fs }).map((r) => r.result)).toEqual([
      "hardlink",
      "hardlink",
    ]);
    nodeFs.appendFileSync(join(main, ".env"), "NEW=2\n");
    expect(nodeFs.readFileSync(join(wt, ".env"), "utf8")).toBe("APP=1\nNEW=2\n");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("EPERM");
    expect(messages[0]).toContain("hard link");
  });

  it("falls back to a copy with a notice when neither link works", () => {
    const fs = { ...nodeFs, symlinkSync: throwing("EPERM"), linkSync: throwing("EXDEV") };

    expect(linkEnvFiles(main, wt, { log, fs }).map((r) => r.result)).toEqual(["copy", "copy"]);
    expect(nodeFs.lstatSync(join(wt, ".env")).isSymbolicLink()).toBe(false);
    expect(nodeFs.readFileSync(join(wt, ".env"), "utf8")).toBe("APP=1\n");
    expect(messages[0]).toContain("EXDEV");
    expect(messages[0]).toContain("copied");
  });

  it("leaves an existing env file in the worktree alone", () => {
    nodeFs.writeFileSync(join(wt, ".env"), "LOCAL=1\n");

    expect(linkEnvFiles(main, wt, { log }).find((r) => r.file === ".env")?.result).toBe("exists");
    expect(nodeFs.readFileSync(join(wt, ".env"), "utf8")).toBe("LOCAL=1\n");
  });

  it("skips files the main checkout doesn't have", () => {
    nodeFs.rmSync(join(main, "cms", ".env"));
    const fs = { ...nodeFs, symlinkSync: throwing("EPERM") };

    expect(linkEnvFiles(main, wt, { log, fs })).toEqual([
      { file: ".env", result: "hardlink" },
      { file: join("cms", ".env"), result: "no-source" },
    ]);
    expect(nodeFs.existsSync(join(wt, "cms", ".env"))).toBe(false);
  });
});
