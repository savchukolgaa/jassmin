// Runs the Aspire CLI (e.g. `pnpm aspire run`) with pnpm's build-script approvals passed through.
// Aspire installs the AppHost with `pnpm install --ignore-workspace`, which skips every
// pnpm-workspace.yaml, so `allowBuilds` has to be passed through the environment instead.
// The variable also reaches the `pnpm install` Aspire runs for `web`, where it replaces the
// workspace's `allowBuilds`, so keep this list in sync with pnpm-workspace.yaml.
import { spawn } from "node:child_process";

const allowBuilds = { "@swc/core": true, "core-js-pure": false, esbuild: true };

// No `shell`: the Aspire CLI installs as a native executable (aspire.exe on Windows), which
// spawn finds on PATH directly. Passing args through a shell is deprecated (DEP0190).
const child = spawn("aspire", process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, pnpm_config_allow_builds: JSON.stringify(allowBuilds) },
});

child.on("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? "Aspire CLI not found on PATH. Install it: https://aspire.dev (see README → Prerequisites)."
      : error,
  );
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
