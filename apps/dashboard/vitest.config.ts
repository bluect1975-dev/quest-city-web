import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../packages/config/vitest.config.base.mjs";

/**
 * Mirrors packages/ui/vitest.config.ts: overrides the shared node
 * environment with jsdom (the only way to render React client components
 * in tests) and points `include` at this app's `app/` and `lib/` trees —
 * there is no `src/` directory here, unlike the shared packages.
 */
export default mergeConfig(
  base,
  defineConfig({
    // This app's tsconfig.json sets `jsx: "preserve"` for Next.js's own
    // SWC-based build (Next requires that exact value and enforces it),
    // but that leaves esbuild's tsconfig-derived jsx transform emitting
    // unimported `React.createElement` calls under vitest. Force the
    // automatic runtime here, scoped to the test run only.
    esbuild: {
      jsx: "automatic",
    },
    test: {
      environment: "jsdom",
      include: ["app/**/*.test.tsx", "lib/**/*.test.tsx", "lib/**/*.test.ts"],
      setupFiles: ["./vitest-setup.ts"],
    },
  }),
);
