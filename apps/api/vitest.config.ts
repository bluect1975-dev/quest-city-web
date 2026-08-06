import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../packages/config/vitest.config.base.mjs";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["lib/**/*.test.ts"],
    },
  }),
);
