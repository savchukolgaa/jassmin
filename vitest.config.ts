import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin doesn't run under tests.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "scripts/**/*.test.mjs"],
    // Tests import server modules (react-router, drizzle, pg) dynamically, and the first import
    // can take several seconds on a cold, busy machine; 5s made them time out.
    testTimeout: 20_000,
  },
});
