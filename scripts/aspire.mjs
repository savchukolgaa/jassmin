// Runs the Aspire CLI (e.g. `pnpm aspire run`) with pnpm's build-script approvals passed through.
// Aspire installs the AppHost with `pnpm install --ignore-workspace`, which skips every
// pnpm-workspace.yaml, so `allowBuilds` has to be passed through the environment instead.
// The variable also reaches the `pnpm install` Aspire runs for `web`, where it replaces the
// workspace's `allowBuilds`, so keep this list in sync with pnpm-workspace.yaml.
import { spawn } from "node:child_process";

const allowBuilds = { "@swc/core": true, "core-js-pure": false, esbuild: true };

const child = spawn("aspire", process.argv.slice(2), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, pnpm_config_allow_builds: JSON.stringify(allowBuilds) },
});

child.on("exit", (code) => process.exit(code ?? 1));
