import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../packages/config/vitest.config.base.mjs";

/**
 * Mirrors apps/dashboard/vitest.config.ts: jsdom for component tests
 * (R3C.1 — Engine Host views), plus the esbuild jsx override this app's
 * `jsx: "preserve"` tsconfig (required by Next's own SWC build) needs
 * under vitest's esbuild-based transform.
 */
export default mergeConfig(
  base,
  defineConfig({
    esbuild: {
      jsx: "automatic",
    },
    test: {
      environment: "jsdom",
      include: ["components/**/*.test.tsx"],
      setupFiles: ["./vitest-setup.ts"],
    },
  }),
);
