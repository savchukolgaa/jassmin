// Runs the Aspire CLI (e.g. `pnpm aspire run`) with pnpm allowed to run esbuild's build script.
// Aspire installs the AppHost with `pnpm install --ignore-workspace`, which skips every
// pnpm-workspace.yaml, so `allowBuilds` has to be passed through the environment instead.
import { spawn } from "node:child_process";

const child = spawn("aspire", process.argv.slice(2), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, pnpm_config_allow_builds: JSON.stringify({ esbuild: true }) },
});

child.on("exit", (code) => process.exit(code ?? 1));
