import { defineConfig, mergeConfig } from "vitest/config";
import base from "../config/vitest.config.base.mjs";

/** Overrides the shared node environment with jsdom — the only package needing a DOM to render React components in tests. */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.tsx"],
      setupFiles: ["./vitest-setup.ts"],
    },
  }),
);
