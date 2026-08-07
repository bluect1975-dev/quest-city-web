import { describe, expect, it } from "vitest";
import { resolveCompatibility, type CompatibilityInput } from "./compatibility-resolver";

function baseInput(overrides: Partial<CompatibilityInput> = {}): CompatibilityInput {
  return {
    platformVersion: "2.1.0",
    webRuntimeVersion: "0.1.0",
    requiredMinPlatformVersion: "2.1.0",
    requiredMinWebRuntimeVersion: "0.1.0",
    requiredMaxTestedWebRuntimeVersion: "0.1.5",
    schemaVersion: "2.0.0",
    supportedSchemaVersions: ["2.0.0"],
    themeId: "QC-THEME-CORE",
    availableThemeIds: ["QC-THEME-CORE", "QC-THEME-ACADEMY"],
    locale: "it-IT",
    supportedLocales: ["it-IT", "en-US"],
    requiredCapabilities: ["DRAG_DROP"],
    availableCapabilities: ["DRAG_DROP", "TEXT_INPUT"],
    contentStatus: "PUBLISHED",
    entitled: true,
    ...overrides,
  };
}

describe("resolveCompatibility — each of 07_09 §21's criteria, independently", () => {
  it("accepts a fully compatible combination", () => {
    const result = resolveCompatibility(baseInput());
    expect(result.compatible).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("rejects when platform version is too low", () => {
    const result = resolveCompatibility(baseInput({ platformVersion: "1.9.0" }));
    expect(result.compatible).toBe(false);
    expect(result.failures).toContain("PLATFORM_VERSION_TOO_LOW");
  });

  it("rejects when web runtime version is too low", () => {
    const result = resolveCompatibility(baseInput({ webRuntimeVersion: "0.0.9" }));
    expect(result.failures).toContain("WEB_RUNTIME_VERSION_TOO_LOW");
  });

  it("rejects when web runtime version exceeds the max tested version", () => {
    const result = resolveCompatibility(baseInput({ webRuntimeVersion: "0.2.0" }));
    expect(result.failures).toContain("WEB_RUNTIME_VERSION_UNTESTED");
  });

  it("rejects an unsupported schema version", () => {
    const result = resolveCompatibility(baseInput({ schemaVersion: "1.0.0" }));
    expect(result.failures).toContain("SCHEMA_VERSION_UNSUPPORTED");
  });

  it("rejects an unavailable theme", () => {
    const result = resolveCompatibility(baseInput({ themeId: "QC-THEME-MISSING" }));
    expect(result.failures).toContain("THEME_UNAVAILABLE");
  });

  it("rejects an unsupported locale", () => {
    const result = resolveCompatibility(baseInput({ locale: "fr-FR" }));
    expect(result.failures).toContain("LOCALE_UNSUPPORTED");
  });

  it("rejects a missing required capability", () => {
    const result = resolveCompatibility(baseInput({ requiredCapabilities: ["VOICE_INPUT"] }));
    expect(result.failures).toContain("CAPABILITY_MISSING");
  });

  it("rejects unpublished content", () => {
    const result = resolveCompatibility(baseInput({ contentStatus: "DRAFT" }));
    expect(result.failures).toContain("CONTENT_NOT_PUBLISHED");
  });

  it("rejects when the caller is not entitled", () => {
    const result = resolveCompatibility(baseInput({ entitled: false }));
    expect(result.failures).toContain("NOT_ENTITLED");
  });

  it("reports every failing dimension at once, not just the first", () => {
    const result = resolveCompatibility(
      baseInput({ platformVersion: "1.0.0", locale: "fr-FR", entitled: false }),
    );
    expect(result.failures).toEqual(
      expect.arrayContaining(["PLATFORM_VERSION_TOO_LOW", "LOCALE_UNSUPPORTED", "NOT_ENTITLED"]),
    );
    expect(result.failures.length).toBe(3);
  });
});
