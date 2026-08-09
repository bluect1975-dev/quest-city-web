import { createHash } from "node:crypto";
import type { BalanceMachineConfig } from "@quest-city-web/learning-engines";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition } from "../stage-orchestration-types";

/**
 * WEB-M4 real content materialization (07_25 v1.0 §7-C, §16-17): a single
 * real Mathematics M06 unit, not test-fixture/demo content (contrast with
 * `packages/test-fixtures` and `apps/student-web/lib/engine-demo-configs.ts`,
 * both explicitly non-real). Source, read-only, from `quest-city-roblox`
 * canonical `main` @ `0ac8f6a5536634ed010088bac14140c1c4e334cf`:
 *  - `docs/03-mathematics/03_14_..._Balance_Machine_Challenge_Package_
 *    Specification_v1_0.md` §11-12 — challenge `MAT-M06-VS-CH001`, baseline
 *    difficulty variant VS-A: "3x - 4 = 11".
 *  - `docs/03-mathematics/03_33_..._Executable_Content_Package_v1_1.md`
 *    §4 — lesson `MAT-M06-U01-L01` phase L8 unlocks `MAT-M06-VS-CH001`.
 *
 * Mapping decision (documented, not silent): the implemented ENG-BALANCE
 * (07_10 §13) models a single-step weight-equality check on a two-pan
 * scale, not VS-A's full two-step algebraic solve ("+4" then "÷3"). This
 * bundle materializes VS-A's balanced-verification step using the exact
 * numbers from the canonical spec: transposing "-4" gives "3x = 11 + 4",
 * i.e. 15 = 15. Left pan carries the isolated "3x" term (weight 15 — the
 * value of 3x at the true solution x=5); right pan carries the two
 * transposed constants (11 and 4) unmerged, so a student must place both
 * to reach the correct total. No numbers here are invented.
 */

export const WEB_M4_MAT_M06_CONTENT_BUNDLE_ID = "9f5a6b2c-4e11-4a8d-9c3f-1b2e7d4a6c50";
export const WEB_M4_MAT_M06_ACTIVITY_ID = "MAT-M06-VS-CH001-balance-verification";
export const WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_m4_mat_m06_balance";
export const WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID = "asn_web_m4_balance_machine";

export const WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG: BalanceMachineConfig = {
  tokens: [
    { tokenId: "term-3x", weight: 15 },
    { tokenId: "constant-11", weight: 11 },
    { tokenId: "constant-4", weight: 4 },
  ],
};

export const WEB_M4_BALANCE_MACHINE_SOLUTION: Record<string, "left" | "right"> = {
  "term-3x": "left",
  "constant-11": "right",
  "constant-4": "right",
};

export const WEB_M4_MAT_M06_ACTIVITY_DEFINITION = {
  activityId: WEB_M4_MAT_M06_ACTIVITY_ID,
  activityVersion: "1.0.0",
  subjectId: "MAT",
  moduleId: "MAT-M06",
  unitId: "MAT-M06-U01",
  sourceChallengeId: "MAT-M06-VS-CH001",
  sourceLessonId: "MAT-M06-U01-L01",
  sourceDifficultyVariant: "VS-A",
  sourceEquation: "3x - 4 = 11",
  objectiveIds: ["MAT-M06-U01-OBJ-EQUATION-BALANCE"],
  validatorRef: "deterministic-weight-equality",
  evidenceRef: "web-m4-balance-machine-evidence",
  outcomePolicyRef: "web-m4-balance-machine-outcome",
  semanticRoles: ["balance-scale", "weight-token", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "0ac8f6a5536634ed010088bac14140c1c4e334cf",
    sourceDocuments: [
      "docs/03-mathematics/03_14_Quest_City_Balance_Machine_Challenge_Package_Specification_v1_0.md#11-12-VS-A",
      "docs/03-mathematics/03_33_Quest_City_Mathematics_M06_U01_Executable_Content_Package_v1_1.md#4",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_M4_MAT_M06_ACTIVITY_DEFINITION);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-m4-mat-m06-balance-verification-v1",
  bundleVersion: "1.0.0",
  bundleType: "ACTIVITY_BUNDLE" as const,
  status: "PUBLISHED" as const,
  subjectId: "MAT",
  moduleId: "MAT-M06",
  contentVersion: "1.0.0",
  publishedAt: "2026-08-09T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html", "keyboard"],
  fallbacksDeclared: true,
  entries: [
    {
      entryId: WEB_M4_MAT_M06_ACTIVITY_ID,
      entryType: "activity",
      path: `activities/${WEB_M4_MAT_M06_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_M4_MAT_M06_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

export const WEB_M4_ACTIVITY_STAGE_ID = "balance-verification";

/**
 * A single-stage sequence wrapping the real Balance Machine activity
 * through the existing Stage/Session Orchestrator (`content-runtime`'s
 * `stage-orchestrator.ts`) — this is how WEB-M4 satisfies both §7-E (reuse
 * `EngineHost`/`SequenceHost`, no new runtime UI) and §7-H (reuse R3C.3's
 * durable `SequenceRuntimeState`, since only `SequenceHost` is wired to
 * it) for a single real activity, without inventing a second persistence
 * mechanism for a bare `EngineHost` usage.
 */
export const WEB_M4_ACTIVITY_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-m4-${WEB_M4_MAT_M06_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_M4_ACTIVITY_STAGE_ID,
      stageType: "BALANCE_MACHINE_CHALLENGE",
      order: 0,
      isInteractive: true,
      activityRef: WEB_M4_MAT_M06_ACTIVITY_ID,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 5 },
      checkpointPolicy: { isCheckpoint: true },
    },
  ],
};
