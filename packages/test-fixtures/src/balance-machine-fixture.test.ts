import { describe, expect, it } from "vitest";
import { validateAgainst } from "@quest-city-web/content-schema";
import {
  balanceMachineActivityDefinition,
  balanceMachineBundleManifest,
  balanceMachineCapabilityProfile,
  balanceMachineExpectedOutcome,
  balanceMachinePresentationAdapter,
  balanceMachineSemanticActions,
  balanceMachineValidatorFixture,
} from "./balance-machine-fixture";

describe("balance machine technical fixture (07_09 §25)", () => {
  it("bundle manifest validates against WebContentBundleManifest (schemaVersion 2.0.0)", () => {
    const result = validateAgainst("webContentBundleManifest", balanceMachineBundleManifest);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
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

  it("every semantic action validates against SemanticAction (canonical vocabulary only)", () => {
    for (const action of balanceMachineSemanticActions) {
      const result = validateAgainst("semanticAction", action);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it("expected outcome validates against Outcome", () => {
    const result = validateAgainst("outcome", balanceMachineExpectedOutcome);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("validator fixture (bundle+adapter+actions+validatorRef+expected outcome) validates against ValidatorFixture", () => {
    const result = validateAgainst("validatorFixture", balanceMachineValidatorFixture);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
