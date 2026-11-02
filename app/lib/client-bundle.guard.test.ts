import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// What the browser downloads before first paint (#96). React Router strips `loader`, `action`
// and `headers` from route modules in the client build, so a route module may import zod schemas
// (`*.schema.ts`) and server code for them. Everything else that the UI reaches must not: a
// module-level `z.object(…)` can't be tree-shaken, so one import of a schema module from a
// component ships all of zod (~24 KB gzip) to every page.
//
// This walks the static value imports (not `import type`) from every page route module and every
// component, and fails when a module on that graph imports `zod`, a `*.schema.ts` module or
// server code.

const APP = join(import.meta.dirname, "..");

const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;
const SCHEMA = /\.schema\.ts$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith("+") || entry.name.startsWith(".") ? [] : sourceFiles(path);
    }
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });
}

/** Value imports and re-exports of a module: `import type` / `export type` don't reach the bundle. */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  const statement =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    const [, , typeOnly, specifier] = match;
    if (!typeOnly && specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/** The file an app import points at, or `undefined` for a package. */
function resolveImport(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("~/")) {
    base = join(APP, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(from), specifier);
  } else {
    return undefined;
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((path) => SOURCE.test(path) && existsSync(path));
}

const name = (path: string) => `app/${relative(APP, path).replaceAll("\\", "/")}`;

/** Why a module on the client graph may not import `specifier`, or `undefined` when it may. */
function forbidden(specifier: string, target: string | undefined): string | undefined {
  if (specifier === "zod") return "zod";
  if (target && SCHEMA.test(target)) return "a zod schema module";
  if (target?.includes(`${join(APP, ".server")}`)) return "server code";
  return undefined;
}

function findClientViolations(): string[] {
  const pageRoutes = sourceFiles(join(APP, "routes")).filter((path) => path.endsWith(".tsx"));
  const ui = [...sourceFiles(join(APP, "components")), ...sourceFiles(join(APP, "features"))];
  const roots = [join(APP, "root.tsx"), ...pageRoutes];

  const violations: string[] = [];
  const seen = new Set<string>();
  const queue = [...ui.filter((path) => !SCHEMA.test(path))];

  // A route module's own imports: schema and server modules are for its loader or action, which
  // the client build strips.
  for (const route of roots) {
    for (const specifier of valueImports(readFileSync(route, "utf8"))) {
      const target = resolveImport(route, specifier);
      if (target && !forbidden(specifier, target)) queue.push(target);
    }
  }

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(readFileSync(file, "utf8"))) {
      const target = resolveImport(file, specifier);
      const reason = forbidden(specifier, target);
      if (reason) {
        violations.push(`${name(file)} imports ${reason} ("${specifier}")`);
      } else if (target) {
        queue.push(target);
      }
    }
  }
  return violations.sort();
}

describe("client bundle", () => {
  it("parses value imports and skips type-only ones", () => {
    const source = [
      'import { z } from "zod";',
      'import type { A } from "./a";',
      "import {\n  b,\n  type C,\n} from './b';",
      'export type { D } from "./d";',
      'export { e } from "./e";',
      'import "./side-effect.css";',
    ].join("\n");
    expect(valueImports(source)).toEqual(["zod", "./b", "./e", "./side-effect.css"]);
  });

  it("keeps zod, schemas and server code out of everything the UI imports", () => {
    expect(findClientViolations()).toEqual([]);
  });
});
