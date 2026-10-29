// `pnpm db:convert-catalog <path to the owner's list>`: converts the owner's Markdown perfume list
// (#66) into `app/.server/db/catalog-data.ts`, applying `catalog/fixes.ts`. The list itself isn't
// committed; commit the generated file, then load it with `pnpm db:import-catalog`.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { CATALOG_FIXES } from "../catalog/fixes";
import { parseCatalogMarkdown } from "../catalog/parse";
import { renderCatalogData } from "../catalog/render";

const OUTPUT = "app/.server/db/catalog-data.ts";

const source = process.argv[2];
if (!source) {
  console.error("Usage: pnpm db:convert-catalog <path to the owner's catalog.md>");
  process.exit(1);
}

try {
  const entries = parseCatalogMarkdown(readFileSync(source, "utf8"), CATALOG_FIXES);
  writeFileSync(OUTPUT, renderCatalogData(entries));
  execSync(`pnpm exec biome format --write ${OUTPUT}`, { stdio: "inherit" });
  const count = (list: string) => entries.filter((e) => e.list === list).length;
  console.log(
    `Wrote ${entries.length} perfumes (${count("women")} women's, ${count("men")} men's) to ${OUTPUT}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
