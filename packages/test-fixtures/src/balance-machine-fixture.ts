/**
 * Technical fixture only (07_09 §25): "La fixture può restare tecnica e non
 * costituisce ancora il package eseguibile dello Step 6." Not real
 * Mathematics M06 content — used to exercise the bundle → engine → attempt
 * pipeline shape ahead of any real content or engine implementation.
 */

export const balanceMachineBundleManifest = {
  bundleId: "fixture-balance-machine-v1",
  bundleType: "RUNTIME_FIXTURE_BUNDLE" as const,
  schemaVersion: "1.0",
  contentVersion: "0.0.1-fixture",
  checksum: "sha256:" + "0".repeat(64),
  publishedAt: "2026-08-05T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html", "keyboard"],
  fallbacksDeclared: true,
};

export const balanceMachineActivityDefinition = {
  activityId: "fixture-balance-machine",
  activityVersion: "0.0.1",
  objectiveIds: ["fixture-objective-equality"],
  validatorRef: "fixture-validator-balance",
  evidenceRef: "fixture-evidence-balance",
  outcomePolicyRef: "fixture-outcome-balance",
  semanticRoles: ["balance-scale", "weight-token", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
};

export const balanceMachinePresentationAdapter = {
  adapterId: "fixture-balance-machine-web-adapter",
  runtimeChannel: "WEB" as const,
  activityId: "fixture-balance-machine",
  engineId: "ENG-BALANCE",
  semanticRoleBindings: {
    "balance-scale": "svg-balance-scale",
    "weight-token": "html-draggable-token",
    "confirm-button": "html-button-primary",
  },
  themeAdapterRef: "QC-THEME-CORE",
};

export const balanceMachineCapabilityProfile = {
  profileId: "fixture-baseline-desktop",
  input: ["pointer", "keyboard"] as const,
  rendering: ["html", "svg"] as const,
  reducedMotion: false,
  viewportClass: "large" as const,
};
