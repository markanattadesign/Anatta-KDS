import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    setupFiles: ["./test/setup.ts"],
  },
});
