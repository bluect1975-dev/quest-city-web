import { createHash } from "node:crypto";
import type { QuickQuestionConfig } from "@quest-city-web/learning-engines";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { HintLevelDescriptor, SequenceDefinition } from "../stage-orchestration-types";

/**
 * M06 Web Full Vertical Slice — Tranche 1 real content materialization
 * (`07_26 v1.0` §13-14): `GUIDED_PRACTICE` + `REFLECTION_AND_RESULT`, the
 * two canonical stages (`07_13 v1.3` §4) this tranche adds. Source,
 * read-only, from `quest-city-roblox` canonical `main` @
 * `7ab2a559319694ccd4323ff3e874e8df71a5080b`:
 *  - `docs/03-mathematics/03_13_..._M06_Lesson_Package_Specification_v1_0.md`
 *    §9 — practice item `PR-M06-L01-01` ("x + 5 = 12" -> "x = 7").
 *  - `docs/03-mathematics/03_13_..._v1_0.md` §11 — hint ladder H1-H4 for
 *    this same item.
 *  - `docs/07-web-learing-platform/07_26_..._v1_0.md` §14 — Tranche 1
 *    implementation handoff, explicitly scoping GUIDED_PRACTICE content to
 *    this one item (`PR-M06-L01-02`/`03` are out of scope for this tranche).
 *
 * Mapping decision (documented, not silent): `07_13` §7 (R3C.2A note)
 * assigns GUIDED_PRACTICE to the orchestration layer (`02_36` §20-bis),
 * dispatching its single interactive micro-step to `ENG-QUICK` in
 * `ENTER_VALUE` mode (numeric answer, no operation-choice UI exists in the
 * current engine set) — `07_26` §14 names `ENG-QUICK` explicitly for this
 * reason. `REFLECTION_AND_RESULT` is presentation/orchestration only
 * (`07_26` §5/§6: "Nessun engine"), so it carries no `activityRef`/
 * `engineDispatchRef` and is not backed by a second `ActivityDefinition`.
 * No numbers or hint text here are invented — all four hint levels and the
 * equation/answer pair are copied verbatim from `03_13` §9/§11.
 */

export const WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID = "b8e6f1a4-2d7c-4f3e-9a1b-6c5d8e4f2a91";
export const WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID = "PR-M06-L01-01-guided-practice";
export const WEB_TRANCHE1_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche1_guided_practice_reflection";
export const WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche1_guided_practice_reflection";

/** `03_13` §9: "x + 5 = 12" -> "x = 7". `tolerance: 0` — the item has a single exact integer answer, no rounding involved. */
export const WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG: QuickQuestionConfig = {
  mode: "ENTER_VALUE",
  expectedValue: 7,
  tolerance: 0,
};

/** `03_13` §11, verbatim — H2-H4 text is specific to `PR-M06-L01-01`'s numbers, not a generic ladder. */
export const WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS: HintLevelDescriptor[] = [
  { level: 1, description: "Quale operazione annulla il termine che vuoi eliminare?" },
  { level: 2, description: "Sottrai 5 da entrambi i membri." },
  { level: 3, description: "x + 5 - 5 = 12 - 5. Ora semplifica." },
  { level: 4, description: "x = 7, perché 7 + 5 = 12." },
];

export const WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_DEFINITION = {
  activityId: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
  activityVersion: "1.0.0",
  subjectId: "MAT",
  moduleId: "MAT-M06",
  unitId: "MAT-M06-U01",
  sourceLessonId: "MAT-M06-U01-L01",
  sourcePracticeId: "PR-M06-L01-01",
  sourceEquation: "x + 5 = 12",
  sourceAnswer: "x = 7",
  objectiveIds: ["MAT.ALG.EQ1-P"],
  validatorRef: "deterministic-numeric-tolerance",
  evidenceRef: "web-tranche1-guided-practice-evidence",
  outcomePolicyRef: "web-tranche1-guided-practice-outcome",
  semanticRoles: ["equation-prompt", "value-input", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "7ab2a559319694ccd4323ff3e874e8df71a5080b",
    sourceDocuments: [
      "docs/03-mathematics/03_13_Quest_City_Mathematics_M06_Lesson_Package_Specification_v1_0.md#9-PR-M06-L01-01",
      "docs/03-mathematics/03_13_Quest_City_Mathematics_M06_Lesson_Package_Specification_v1_0.md#11-hint-ladder",
      "docs/07-web-learing-platform/07_26_Quest_City_Web_M06_Full_Vertical_Slice_Canonical_Completion_Definition_v1_0.md#14",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_DEFINITION);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche1-guided-practice-reflection-v1",
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
      entryId: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
      entryType: "activity",
      path: `activities/${WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

export const WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID = "guided-practice";
export const WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID = "reflection-and-result";

/**
 * Two-stage sequence (`07_26` §13-14, `07_13` §4 canonical `stageType`
 * values): `GUIDED_PRACTICE` dispatches to `ENG-QUICK` through the existing
 * Stage/Session Orchestrator, exactly the pattern
 * `WEB_M4_ACTIVITY_SEQUENCE_DEFINITION` established (`web-m4-real-content.ts`)
 * — no second persistence mechanism, no new orchestrator code.
 * `REFLECTION_AND_RESULT` is `isInteractive: false` (no engine, per `07_26`
 * §6): the orchestrator advances past it on `advanceStage` (`MANUAL`-style,
 * driven by `SequenceHost`'s existing non-interactive continue action),
 * completing the sequence since it is the last stage.
 */
export const WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche1-${WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
      stageType: "GUIDED_PRACTICE",
      order: 0,
      isInteractive: true,
      activityRef: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 5 },
      hintPolicy: { maxHintLevel: 4, levels: WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS },
      checkpointPolicy: { isCheckpoint: true },
    },
    {
      stageId: WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID,
      stageType: "REFLECTION_AND_RESULT",
      order: 1,
      isInteractive: false,
    },
  ],
};
