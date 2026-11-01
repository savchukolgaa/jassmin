import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_KEYS, PAGES } from "./paths";

// Every internal URL is built from the path table (#84): a hard-coded `"/cart"` or `to="/"` would
// send English visitors to a Ukrainian page (or an old path through a redirect). This scans the
// app's source for string literals that start with a page's first segment, in either language or
// from before #84, outside `app/lib/paths.ts`.

const APP = join(import.meta.dirname, "..");

/** Files that may spell paths out: the table itself and the route config built from it. */
const ALLOWED_FILES = new Set(["lib/paths.ts", "routes.ts"]);

const SEGMENTS = new Set(
  PAGE_KEYS.flatMap((page) => [PAGES[page].uk, PAGES[page].en])
    .map((pattern) => pattern.split("/")[0] ?? "")
    .filter((segment) => segment !== "" && !segment.startsWith(":"))
    // Paths from before #84 and the English prefix.
    .concat(["products", "en", "uk"]),
);

/** A quoted literal starting with `/<segment>`, or a bare `"/"` link or redirect. */
const HARD_CODED = new RegExp(
  `["'\`]/(?:${[...SEGMENTS].join("|")})(?=[/?#"'\`]|$)|(?:to=|redirect\\()["'\`]/["'\`]`,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith("+") || entry.name === "__fixtures__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Comment lines describe routes (`/blog/:slug`), they don't link to them. */
function isComment(line: string): boolean {
  return /^\s*(?:\/\/|\/?\*)/.test(line);
}

function findHardCodedPaths(files: string[]): string[] {
  return files.flatMap((file) => {
    const name = relative(APP, file).replaceAll("\\", "/");
    if (ALLOWED_FILES.has(name)) {
      return [];
    }
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        !isComment(line) && HARD_CODED.test(line)
          ? [`app/${name}:${index + 1}: ${line.trim()}`]
          : [],
      );
  });
}

describe("internal paths", () => {
  it("are only written in app/lib/paths.ts", () => {
    const files = sourceFiles(APP);
    expect(files.some((file) => file.endsWith("Header.tsx"))).toBe(true);
    expect(findHardCodedPaths(files)).toEqual([]);
  });

  it("are caught when hard-coded", () => {
    for (const line of [
      'to="/cart"',
      "redirect(`/checkout/success/42`)",
      'to="/"',
      'href="/koshyk"',
      "'/en/blog'",
      '"/products/abc"',
    ]) {
      expect(HARD_CODED.test(line), line).toBe(true);
    }
    for (const line of [
      'action="/locale"',
      'action="/consent"',
      '"/og-default.jpg"',
      'path: "/"',
    ]) {
      expect(HARD_CODED.test(line), line).toBe(false);
    }
  });
});
