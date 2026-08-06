import { describe, expect, it } from "vitest";
import { balanceMachineBundleManifest } from "../../test-fixtures/src/balance-machine-fixture";
import { loadBundleManifest } from "./bundle-loader";

describe("loadBundleManifest", () => {
  it("accepts the balance machine RUNTIME_FIXTURE_BUNDLE fixture", () => {
    const result = loadBundleManifest(balanceMachineBundleManifest);
    expect(result.ok).toBe(true);
  });

  it("rejects a bundle type other than RUNTIME_FIXTURE_BUNDLE at WEB-M0", () => {
    const result = loadBundleManifest({
      ...balanceMachineBundleManifest,
      bundleType: "LESSON_BUNDLE",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a structurally invalid manifest", () => {
    const result = loadBundleManifest({ bundleId: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
