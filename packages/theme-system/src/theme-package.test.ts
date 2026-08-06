import { describe, expect, it } from "vitest";
import { QC_THEME_CORE, resolveTheme } from "./theme-package";

describe("theme-system fallback", () => {
  it("QC-THEME-CORE is always available", () => {
    expect(QC_THEME_CORE.isAlwaysAvailableFallback).toBe(true);
  });

  it("falls back to QC-THEME-CORE for an unknown theme id", () => {
    const resolved = resolveTheme("QC-THEME-DOES-NOT-EXIST");
    expect(resolved.themeId).toBe("QC-THEME-CORE");
  });
});
