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
    // Multiple test FILES here (identity-flow.test.ts, identity-security.test.ts, ...)
    // share one live external Postgres instance and each does a destructive
    // `TRUNCATE ... CASCADE` in its own beforeEach. Vitest's default file
    // parallelism runs files concurrently in separate workers against the
    // SAME database, so one file's TRUNCATE can wipe rows another file's
    // test just inserted mid-fixture — a real, observed FK-violation
    // failure, not a flaky test. Integration suites against one shared
    // external resource must run file-sequential.
    fileParallelism: false,
  },
});
