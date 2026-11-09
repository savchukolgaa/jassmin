import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  build: isSsrBuild
    ? {}
    : {
        rolldownOptions: {
          output: {
            // The app's shared code (components, features, lib) in one chunk instead of ~20 chunks
            // of 1–5 KB, each a request before first paint (#96). Code that only one route uses
            // (`minShareCount`) stays in that route's chunk, which the page loads anyway.
            codeSplitting: {
              groups: [
                {
                  name: "app",
                  test: /[\\/]app[\\/](components|features|lib)[\\/]/,
                  minShareCount: 2,
                },
              ],
            },
          },
        },
      },
  server: {
    // Issue worktrees live inside the repo (see AGENTS.md), and the Python generator (#131) has
    // its own virtualenv; don't watch their files.
    watch: { ignored: ["**/.claude/worktrees/**", "**/analytics/**"] },
  },
}));
