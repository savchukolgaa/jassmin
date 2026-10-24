// Starts `/create-plan <n>` for several issues at once, each in its own Herdr tab
// (e.g. `pnpm herdr:plans 11 19 43`). For every issue it prepares the worktree
// `.claude/worktrees/issue-<n>` on branch `issue/<n>` (see docs/skills/worktree.md), copies `.env`,
// opens a tab labelled `issue-<n>`, starts an agent named `issue-<n>` and sends it the prompt.
// Worktrees are created one after another so parallel agents never race for git's locks.
// Must run inside a Herdr pane; the agents keep running after the script exits.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const usage =
  "Usage: pnpm herdr:plans <issue> [<issue> ...] [--kind <agent>]  (default kind: claude)";

const args = process.argv.slice(2);
let kind = "claude";
const issues = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--kind") {
    kind = args[++i] ?? "";
  } else if (/^\d+$/.test(arg)) {
    issues.push(arg);
  } else {
    fail(`Unexpected argument "${arg}".\n${usage}`);
  }
}
if (issues.length === 0 || !kind) fail(usage);
if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_WORKSPACE_ID) {
  fail("Not running inside a Herdr pane (HERDR_ENV=1 is required).");
}

// No `shell`: git and herdr are executables on PATH, and arguments stay unquoted (DEP0190).
const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...gitArgs) => run("git", gitArgs);
const herdr = (...herdrArgs) => JSON.parse(run("herdr", herdrArgs));

// The main checkout is the first entry of `git worktree list`, wherever the script runs from.
const main = git("worktree", "list", "--porcelain").match(/^worktree (.+)$/m)?.[1];
if (!main) fail("Could not find the main checkout.");
git("-C", main, "fetch", "origin");

const liveAgents = new Set(
  herdr("agent", "list")
    .result.agents.map((agent) => agent.name)
    .filter(Boolean),
);

let failed = 0;
for (const n of issues) {
  const name = `issue-${n}`;
  try {
    if (liveAgents.has(name)) {
      console.log(`#${n}: agent "${name}" is already running, skipped.`);
      continue;
    }
    const wt = prepareWorktree(n);
    const tab = herdr(
      "tab",
      "create",
      "--workspace",
      process.env.HERDR_WORKSPACE_ID,
      "--cwd",
      wt,
      "--label",
      name,
      "--no-focus",
    );
    const paneId = tab.result.root_pane.pane_id;
    herdr("agent", "start", name, "--kind", kind, "--pane", paneId, "--timeout", "60000");
    herdr(
      "agent",
      "prompt",
      name,
      `/create-plan ${n} — The worktree .claude/worktrees/${name} (branch issue/${n}) and .env ` +
        "already exist; reuse them. Stop after committing the plan and report open questions.",
    );
    console.log(`#${n}: planning in tab "${name}" (${tab.result.tab.tab_id}), worktree ${wt}`);
  } catch (error) {
    failed++;
    console.error(`#${n}: ${error.stderr?.trim() || error.message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);

// Same priority order as docs/skills/worktree.md: existing worktree, local branch, remote branch,
// otherwise a new branch from origin/main.
function prepareWorktree(n) {
  const branch = `issue/${n}`;
  const wt = join(main, ".claude", "worktrees", `issue-${n}`);
  const existing = git("-C", main, "worktree", "list", "--porcelain")
    .split(/\n\n+/)
    .find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`))
    ?.match(/^worktree (.+)$/m)?.[1];
  if (existing) {
    copyEnv(existing);
    return existing;
  }
  if (git("-C", main, "branch", "--list", branch)) {
    git("-C", main, "worktree", "add", wt, branch);
  } else if (git("-C", main, "ls-remote", "--heads", "origin", branch)) {
    git("-C", main, "worktree", "add", "--track", "-b", branch, wt, `origin/${branch}`);
  } else {
    git("-C", main, "worktree", "add", "-b", branch, wt, "origin/main");
  }
  copyEnv(wt);
  return wt;
}

function copyEnv(wt) {
  const source = join(main, ".env");
  const target = join(wt, ".env");
  if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
