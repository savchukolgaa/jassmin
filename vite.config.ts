import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // Issue worktrees live inside the repo (see AGENTS.md); don't watch their files.
    watch: { ignored: ["**/.claude/worktrees/**"] },
  },
});
