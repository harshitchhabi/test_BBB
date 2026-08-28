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
    // Each PGlite instance is a real WASM Postgres — memory-heavy enough
    // that running every test file's instance at once (the default, one
    // fork per file in parallel) exhausted available memory once the
    // suite grew past ~7 files ("Array buffer allocation failed" / worker
    // forks dying). Running files one at a time trades some wall-clock
    // time for actually finishing.
    fileParallelism: false,
  },
});
