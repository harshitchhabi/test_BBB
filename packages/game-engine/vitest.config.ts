import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Each test file gets its own PGlite instance (see tests/test-db.ts) and
    // must set process.env.DATABASE_URL before dynamically importing "db"/
    // "game-engine" — running files in separate processes/threads keeps
    // that env var and the module cache from leaking across files.
    pool: "forks",
  },
});
