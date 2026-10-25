// Links an issue worktree's env files to the main checkout's (#49), so they never go stale:
// `.env` (the app) and `cms/.env` (Strapi). Each link is a symlink when the OS allows it. Windows
// only allows file symlinks with Developer Mode or elevated rights, so it falls back to a hard link
// (no rights needed, stays in sync while the file is edited in place) and then to a copy, printing
// a notice for each fallback. Existing files and links in the worktree are left alone.
// Used by scripts/herdr-plans.mjs; run it by hand from a worktree with `node scripts/link-env.mjs`.
import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_FILES = [".env", join("cms", ".env")];

/**
 * @typedef {"symlink" | "hardlink" | "copy" | "exists" | "no-source"} LinkResult
 * @param {string} main The main checkout.
 * @param {string} wt The worktree whose env files should point at the main checkout's.
 * @param {{ log?: (message: string) => void, fs?: typeof nodeFs }} [options]
 * @returns {{ file: string, result: LinkResult }[]}
 */
export function linkEnvFiles(main, wt, { log = console.log, fs = nodeFs } = {}) {
  return ENV_FILES.map((file) => ({ file, result: linkFile(main, wt, file, log, fs) }));
}

/** @returns {LinkResult} */
function linkFile(main, wt, file, log, fs) {
  const source = resolve(main, file);
  const target = resolve(wt, file);
  if (!fs.existsSync(source)) return "no-source";
  // lstat, not exists: a dangling symlink still counts as "already there".
  if (fs.lstatSync(target, { throwIfNoEntry: false })) return "exists";
  try {
    fs.symlinkSync(source, target, "file");
    return "symlink";
  } catch (symlinkError) {
    try {
      fs.linkSync(source, target);
      log(
        `${file}: symlinks aren't permitted (${errorCode(symlinkError)}), created a hard link ` +
          "instead. It stays in sync unless an editor replaces the file rather than saving in place.",
      );
      return "hardlink";
    } catch (linkError) {
      fs.copyFileSync(source, target);
      log(
        `${file}: couldn't link (${errorCode(symlinkError)}, ${errorCode(linkError)}), copied it ` +
          `instead. Copy ${source} again when it changes.`,
      );
      return "copy";
    }
  }
}

function errorCode(error) {
  return error instanceof Error && "code" in error ? error.code : String(error);
}

// CLI: `node scripts/link-env.mjs [<worktree>]` (default: the current directory). The main checkout
// is the first entry of `git worktree list`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wt = resolve(process.argv[2] ?? process.cwd());
  const main = execFileSync("git", ["-C", wt, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }).match(/^worktree (.+)$/m)?.[1];
  if (!main) {
    console.error("Could not find the main checkout.");
    process.exit(1);
  }
  if (resolve(main) === wt) {
    console.error("This is the main checkout; run it from (or pass) an issue worktree.");
    process.exit(1);
  }
  for (const { file, result } of linkEnvFiles(main, wt)) {
    console.log(`${file}: ${result}`);
  }
}
