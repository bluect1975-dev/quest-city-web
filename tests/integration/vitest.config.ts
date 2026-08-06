import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.ts"],
    testTimeout: 15000,
    // Must comfortably exceed waitForOk's own retry budget in
    // health-endpoints.test.ts (20 attempts x 1000ms = up to ~20s) plus
    // fetch overhead, since that retrying happens inside this hook.
    hookTimeout: 30000,
  },
});
