// The AI perfumer's saved chats (#180) hold what customers wrote: their text stays in
// `perfumer_threads` / `perfumer_messages` and never reaches the analytics side. The synthetic
// data generator, the dbt warehouse and the ML notebooks (`analytics/`) read perfumer activity only
// from `user_events` (#166), which carries no text. This test fails when any of their sources
// names a chat table, so that never changes by accident.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/** Folders the uv projects and tools create; not sources. */
const SKIPPED_DIRS = new Set([
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  "target",
  "dbt_packages",
  "logs",
  "node_modules",
  ".ipynb_checkpoints",
]);

/** Code, queries, configuration and notebooks; prose (`.md`) may name the tables to forbid them. */
const SOURCE_EXTENSIONS = new Set([".py", ".sql", ".yml", ".yaml", ".toml", ".ipynb", ".json"]);

const CHAT_TABLE = /\bperfumer_(threads|messages)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sources(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("saved perfumer chats stay out of analytics (#180)", () => {
  const files = sources("analytics");

  it("finds the analytics sources", () => {
    expect(files.some((file) => file.endsWith(".sql"))).toBe(true);
    expect(files.some((file) => file.endsWith(".py"))).toBe(true);
  });

  it("never reads the chat tables in the generator, the warehouse or the notebooks", () => {
    const naming = files.filter((file) => CHAT_TABLE.test(readFileSync(file, "utf8")));
    expect(naming).toEqual([]);
  });
});
