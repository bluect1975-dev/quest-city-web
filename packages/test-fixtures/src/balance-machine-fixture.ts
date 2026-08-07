/**
 * Technical fixture only (07_09 §25): "La fixture può restare tecnica e non
 * costituisce ancora il package eseguibile dello Step 6." Not real
 * Mathematics M06 content — used to exercise the bundle → engine → attempt
 * pipeline shape ahead of any real content or engine implementation.
 *
 * WEB-M2 extends this fixture (schemaVersion 2.0.0 shapes, see
 * docs/adr/0003) with the remaining §25 checklist items that were missing
 * at WEB-M0: semantic actions, validator ref, expected evidence/outcome.
 */

export const balanceMachineBundleManifest = {
  bundleSchemaVersion: "1.0.0",
  bundleId: "fixture-balance-machine-v1",
  bundleVersion: "1.0.0",
  bundleType: "RUNTIME_FIXTURE_BUNDLE" as const,
  status: "PUBLISHED" as const,
  subjectId: "MAT",
  moduleId: "MAT-M06",
  contentVersion: "0.0.1-fixture",
  publishedAt: "2026-08-05T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html", "keyboard"],
  fallbacksDeclared: true,
  entries: [
    {
      entryId: "fixture-balance-machine",
      entryType: "activity",
      path: "activities/fixture-balance-machine.json",
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: "sha256:" + "1".repeat(64),
      required: true,
    },
  ],
  integrity: { algorithm: "sha256" as const, digest: "0".repeat(64) },
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

/**
 * Semantic actions exercising the balance-machine pipeline: place two
 * weight tokens, then confirm the solution (07_08 §6 canonical vocabulary
 * only — PLACE_ITEM, CONFIRM_SOLUTION).
 */
export const balanceMachineSemanticActions = [
  {
    actionId: "fixture-act-1",
    attemptId: "fixture-attempt",
    activityId: "fixture-balance-machine",
    actionType: "PLACE_ITEM" as const,
    targetRole: "weight-token",
    payload: { tokenId: "w5", side: "left", weight: 5 },
    clientSequence: 0,
    runtimeChannel: "WEB" as const,
    occurredAt: "2026-08-05T00:00:01.000Z",
  },
  {
    actionId: "fixture-act-2",
    attemptId: "fixture-attempt",
    activityId: "fixture-balance-machine",
    actionType: "PLACE_ITEM" as const,
    targetRole: "weight-token",
    payload: { tokenId: "w5b", side: "right", weight: 5 },
    clientSequence: 1,
    runtimeChannel: "WEB" as const,
    occurredAt: "2026-08-05T00:00:02.000Z",
  },
  {
    actionId: "fixture-act-3",
    attemptId: "fixture-attempt",
    activityId: "fixture-balance-machine",
    actionType: "CONFIRM_SOLUTION" as const,
    targetRole: "confirm-button",
    payload: {},
    clientSequence: 2,
    runtimeChannel: "WEB" as const,
    occurredAt: "2026-08-05T00:00:03.000Z",
  },
];

export const balanceMachineExpectedOutcome = {
  attemptId: "fixture-attempt",
  completionStatus: "CONSOLIDATED" as const,
  score: 1,
  consolidatedAt: "2026-08-05T00:00:04.000Z",
};

/**
 * ValidatorFixture (07_08 §25 checklist): bundle manifest, Activity
 * Definition, adapter refs, semantic actions, validator ref, expected
 * evidence/outcome, parity group — bundled together for cross-runtime
 * parity testing.
 */
export const balanceMachineValidatorFixture = {
  fixtureId: "fixture-balance-machine-validator",
  activityId: "fixture-balance-machine",
  activityVersion: "0.0.1",
  runtimeChannel: "WEB" as const,
  validatorRef: "fixture-validator-balance",
  parityGroup: "fixture-balance-machine-parity",
  semanticActions: balanceMachineSemanticActions,
  expectedEvidence: { balanced: true, leftWeight: 5, rightWeight: 5 },
  expectedOutcome: { score: 1 },
};
