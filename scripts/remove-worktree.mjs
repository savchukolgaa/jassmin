// Removes an issue worktree (e.g. `pnpm worktree:remove 49`) without touching pnpm's shared store
// (#49). `node_modules` folders are trees of junctions into the global virtual store, and Git for
// Windows' `git worktree remove` follows junctions: it deletes files inside the shared store, then
// fails with "Directory not empty". So this deletes every `node_modules` in the worktree first with
// `fs.rmSync`, which unlinks junctions and symlinks without following them, and only then runs
// `git worktree remove`. Like git, it refuses a worktree with uncommitted or untracked changes.
// Deleting the branches is a separate step (see docs/skills/worktree.md → Worktree Cleanup).
import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deletes every `node_modules` folder under `wt` (not descending into them or into links) and
 * returns their paths. A `node_modules` that is itself a link is unlinked, never followed.
 * @param {string} wt
 * @param {typeof nodeFs} [fs]
 * @returns {string[]}
 */
export function removeDependencyFolders(wt, fs = nodeFs) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.name === "node_modules") found.push(path);
      else if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path);
    }
  };
  walk(wt);
  for (const path of found) fs.rmSync(path, { recursive: true, force: true });
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = process.argv[2];
  if (!n || !/^\d+$/.test(n)) fail("Usage: pnpm worktree:remove <issue>");

  const run = (args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const list = run(["worktree", "list", "--porcelain"]);
  const main = list.match(/^worktree (.+)$/m)?.[1];
  if (!main) fail("Could not find the main checkout.");
  const wt = list
    .split(/\n\n+/)
    .find((entry) => entry.split("\n").includes(`branch refs/heads/issue/${n}`))
    ?.match(/^worktree (.+)$/m)?.[1];
  if (!wt) fail(`No worktree for branch issue/${n}.`);
  if (resolve(wt) === resolve(main)) fail("Refusing to remove the main checkout.");

  const status = run(["-C", wt, "status", "--porcelain"]);
  if (status) fail(`${wt} has uncommitted or untracked changes:\n${status}`);

  for (const path of removeDependencyFolders(wt)) console.log(`Deleted ${path}`);
  try {
    run(["-C", main, "worktree", "remove", wt]);
  } catch (error) {
    fail(error.stderr?.trim() || error.message);
  }
  console.log(`Removed worktree ${wt}. Delete the branches with:`);
  console.log(`  git branch -D issue/${n}\n  git push origin --delete issue/${n}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
