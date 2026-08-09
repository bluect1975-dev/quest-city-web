import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../packages/config/vitest.config.base.mjs";

/**
 * Mirrors apps/dashboard/vitest.config.ts: jsdom for component tests
 * (R3C.1 — Engine Host views), plus the esbuild jsx override this app's
 * `jsx: "preserve"` tsconfig (required by Next's own SWC build) needs
 * under vitest's esbuild-based transform. WEB-M4 extends `include` to
 * `app/**` and `lib/**` (previously `components/**` only) — this app now
 * has real page-level tests (login, home, activity, result) and
 * lib-level client/context logic that need coverage, same pattern
 * `apps/dashboard`'s config already established.
 */
export default mergeConfig(
  base,
  defineConfig({
    esbuild: {
      jsx: "automatic",
    },
    test: {
      environment: "jsdom",
      include: ["components/**/*.test.tsx", "app/**/*.test.tsx", "lib/**/*.test.tsx", "lib/**/*.test.ts"],
      setupFiles: ["./vitest-setup.ts"],
    },
  }),
);
