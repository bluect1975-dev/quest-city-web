import { describe, expect, it } from "vitest";
import { validateAgainst } from "@quest-city-web/content-schema";
import {
  balanceMachineActivityDefinition,
  balanceMachineBundleManifest,
  balanceMachineCapabilityProfile,
  balanceMachinePresentationAdapter,
} from "./balance-machine-fixture";

describe("balance machine technical fixture (07_09 §25)", () => {
  it("bundle manifest validates against WebContentBundleManifest", () => {
    expect(validateAgainst("webContentBundleManifest", balanceMachineBundleManifest).valid).toBe(
      true,
    );
  });

  it("activity definition validates against ActivityDefinition", () => {
    expect(validateAgainst("activityDefinition", balanceMachineActivityDefinition).valid).toBe(
      true,
    );
  });

  it("presentation adapter validates against PresentationAdapter", () => {
    expect(
      validateAgainst("presentationAdapter", balanceMachinePresentationAdapter).valid,
    ).toBe(true);
  });

  it("capability profile validates against CapabilityProfile", () => {
    expect(validateAgainst("capabilityProfile", balanceMachineCapabilityProfile).valid).toBe(
      true,
    );
  });

  it("is marked RUNTIME_FIXTURE_BUNDLE, never a production bundle type", () => {
    expect(balanceMachineBundleManifest.bundleType).toBe("RUNTIME_FIXTURE_BUNDLE");
  });
});
