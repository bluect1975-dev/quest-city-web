import { defineConfig, mergeConfig } from "vitest/config";
import base from "../config/vitest.config.base.mjs";

export default mergeConfig(base, defineConfig({}));
