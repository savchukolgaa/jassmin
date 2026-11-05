import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin doesn't run under tests.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // The app as deployed behind one proxy (#143): route tests send `X-Forwarded-For` to stand for
    // different clients. `client-ip.test.ts` passes its hop counts explicitly.
    env: { TRUSTED_PROXY_HOPS: "1" },
    include: ["app/**/*.test.ts", "cms/src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // Tests import server modules (react-router, drizzle, pg) dynamically, and the first import
    // can take several seconds on a cold, busy machine; 5s made them time out.
    testTimeout: 20_000,
    // Integration tests create and drop a throwaway database each; PostgreSQL runs those one at a
    // time, so a drop can wait well past the 10s default while other files set up theirs.
    hookTimeout: 30_000,
  },
});
