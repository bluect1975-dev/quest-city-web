import { createHash } from "node:crypto";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition, StageDefinition } from "../stage-orchestration-types";
import {
  WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
  WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
  WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
} from "./web-tranche5-intro-hook-content";
import {
  WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
  WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
} from "./web-tranche3-prerequisite-check-micro-lesson-content";
import {
  WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
} from "./web-tranche2-quick-question-set-content";
import {
  WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
} from "./web-tranche1-guided-practice-content";
import {
  WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
  WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
} from "./web-tranche4-interactive-exercise-content";
import {
  WEB_M4_ACTIVITY_SEQUENCE_DEFINITION,
  WEB_M4_ACTIVITY_STAGE_ID,
  WEB_M4_MAT_M06_ACTIVITY_ID,
  WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
} from "./web-m4-real-content";

/**
 * M06 Web Full Vertical Slice — Tranche 6 (`07_26 v1.1` §17.4): the single
 * unified 8-canonical-stage `SequenceDefinition` Tranches 1-5/WEB-M4 each
 * materialized separately. This module never redefines a stage's content,
 * engine config, hint ladder or progression rule — every `StageDefinition`
 * below is the exact object each prior tranche already exported, only
 * reordered into the canonical `07_13` §4 sequence and given fresh, globally
 * unique `order` values.
 *
 * Attempt-boundary decision (this authorization's discovery phase, `02_36
 * v1.4` §20-bis.8/§11-bis vs `07_15_01 v1.3` §11-bis.2-bis): the existing
 * Tranche 3 sequence already proves the working model — one interactive
 * stage's dispatch produces one `learning_attempt`, and any non-interactive
 * stages that follow it *before the next interactive stage* share that same
 * attempt via the orchestration-stage-entry trigger. This module extends
 * that exact model across group boundaries: each of the 5 interactive
 * canonical stages keeps its own, already-existing `learning_attempt`
 * lifecycle (same content bundle, same assignment, same server-side engine
 * dispatch entry as its original standalone tranche — nothing added there),
 * resolved lazily by `FullSequenceHost` as the outer orchestration reaches
 * it and recorded via the existing (previously dormant since R3C.2)
 * `addAttemptReference`/`attemptReferences[]` mechanism. `REFLECTION_AND_RESULT`
 * is the one exception: in the original Tranche 1 sequence it shares
 * `GUIDED_PRACTICE`'s attempt because it immediately follows it; here it is
 * separated by two other groups (`INTERACTIVE_EXERCISE`,
 * `BALANCE_MACHINE_CHALLENGE`), so it is given its own minimal, wholly
 * non-interactive content bundle/assignment — structurally identical to
 * `INTRO_HOOK` (Tranche 5), not new content, just the same "a stage group
 * needs some attempt to open/close" plumbing applied a second time.
 *
 * No content bundle, ActivityDefinition, engine config or server-side
 * dispatch entry is duplicated: `engine-dispatch-resolution.ts` and
 * `AttemptConsolidationService` are untouched by this tranche.
 */

export const WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID = "83abea48-9cdb-4f4a-a223-1998d7f3346c";
export const WEB_TRANCHE6_REFLECTION_ACTIVITY_ID = "MAT-M06-U01-full-sequence-reflection";
export const WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche6_full_sequence_reflection";
export const WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche6_full_sequence_reflection";
export const WEB_TRANCHE6_REFLECTION_STAGE_ID = "reflection-and-result";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * No new student-facing copy: `FullSequenceHost` renders this stage exactly
 * like Tranche 1's own `REFLECTION_AND_RESULT` (`recapStageId:
 * "guided-practice"`, no `stagePrompts` entry) — a recap of the outer
 * sequence's own `guided-practice` stage stats, reusing existing i18n keys.
 */
const reflectionEntryContent = { recapPattern: "reuses-tranche1-reflection-and-result-ux" } as const;
const reflectionEntryContentJson = JSON.stringify(reflectionEntryContent);
const reflectionEntryDigest = sha256Hex(reflectionEntryContentJson);

const reflectionManifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche6-full-sequence-reflection-v1",
  bundleVersion: "1.0.0",
  bundleType: "ACTIVITY_BUNDLE" as const,
  status: "PUBLISHED" as const,
  subjectId: "MAT",
  moduleId: "MAT-M06",
  contentVersion: "1.0.0",
  publishedAt: "2026-08-10T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html"],
  fallbacksDeclared: true,
  entries: [
    {
      entryId: WEB_TRANCHE6_REFLECTION_ACTIVITY_ID,
      // Same rationale as Tranche 5's INTRO_HOOK entry: presentation
      // content, not an ActivityDefinition (no objectives/validator).
      entryType: "presentation",
      path: `activities/${WEB_TRANCHE6_REFLECTION_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/intro-hook-presentation-content/1.0.0",
      contentDigest: `sha256:${reflectionEntryDigest}`,
      required: true,
    },
  ],
};
const reflectionManifestDigest = sha256Hex(JSON.stringify(reflectionManifestCore));

export const WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...reflectionManifestCore,
  integrity: { algorithm: "sha256", digest: reflectionManifestDigest },
};

/**
 * Single-stage, wholly non-interactive sequence — registered in
 * `packages/attempts`' `orchestration-stage-entry-resolution.ts`
 * `KNOWN_NON_INTERACTIVE_SEQUENCES`, exactly like `INTRO_HOOK`, so its own
 * dedicated attempt can leave `CREATED` via the existing
 * `POST /attempts/{attemptId}/orchestration-stage-entry` trigger.
 */
export const WEB_TRANCHE6_REFLECTION_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche6-${WEB_TRANCHE6_REFLECTION_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [{ stageId: WEB_TRANCHE6_REFLECTION_STAGE_ID, stageType: "REFLECTION_AND_RESULT", order: 0, isInteractive: false }],
};

/** Durable `sequence_runtime_state` key for the outer orchestration state — R3C.3 infrastructure, reused unchanged, no assignment/attempt of its own. */
export const WEB_TRANCHE6_FULL_SEQUENCE_ID = "web-tranche6-MAT-M06-U01-full-sequence";

const rawStagesInCanonicalOrder: StageDefinition[] = [
  ...WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION.stages, // 1. INTRO_HOOK
  ...WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION.stages, // 2. PREREQUISITE_CHECK, 3. MICRO_LESSON x7
  ...WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION.stages, // 4. QUICK_QUESTION_SET
  ...WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION.stages.filter((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID), // 5. GUIDED_PRACTICE (REFLECTION_AND_RESULT excluded here — reintroduced last, in its own group, below)
  ...WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION.stages, // 6. INTERACTIVE_EXERCISE
  ...WEB_M4_ACTIVITY_SEQUENCE_DEFINITION.stages, // 7. BALANCE_MACHINE_CHALLENGE
  ...WEB_TRANCHE6_REFLECTION_SEQUENCE_DEFINITION.stages, // 8. REFLECTION_AND_RESULT
];

/**
 * The single unified 8-canonical-stage-type (14 `StageDefinition` entries,
 * `MICRO_LESSON` expanded per its own 7 sub-steps) `SequenceDefinition`
 * `07_26 v1.1` §17.4 assigns to Tranche 6. `order` is recomputed
 * sequentially here — the source order values above (each scoped to their
 * own, now-superseded standalone sequence) are discarded, never reused.
 */
export const WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: WEB_TRANCHE6_FULL_SEQUENCE_ID,
  sequenceVersion: "1.0.0",
  stages: rawStagesInCanonicalOrder.map((stage, index) => ({ ...stage, order: index })),
};

export interface WebTranche6StageGroup {
  /** The stageId that introduces this group in canonical order — the key `attemptReferences[]` records this group's attemptId under. */
  groupStageId: string;
  assignmentPublicId: string;
  activityId: string;
  contentBundleId: string;
}

/**
 * The 7 attempt-bearing groups, in canonical order. Every one of the 14
 * stages in `WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION` belongs to exactly
 * one group — `resolveWebTranche6StageGroup` below derives full membership
 * (including the 7 `MICRO_LESSON` sub-stages, which belong to the
 * `prerequisite-check` group) purely from stage order, so this array only
 * ever lists each group's *first* stage.
 */
const WEB_TRANCHE6_STAGE_GROUPS: WebTranche6StageGroup[] = [
  {
    groupStageId: WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_M4_ACTIVITY_STAGE_ID,
    assignmentPublicId: WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_M4_MAT_M06_ACTIVITY_ID,
    contentBundleId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  },
  {
    groupStageId: WEB_TRANCHE6_REFLECTION_STAGE_ID,
    assignmentPublicId: WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID,
    activityId: WEB_TRANCHE6_REFLECTION_ACTIVITY_ID,
    contentBundleId: WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
  },
];

export class UnknownWebTranche6StageError extends Error {
  constructor(stageId: string) {
    super(`"${stageId}" is not a stage of WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION`);
    this.name = "UnknownWebTranche6StageError";
  }
}

/**
 * Walks the outer sequence's stages in canonical order, tracking which
 * group is "current" (advancing it only when a group-head stageId is
 * reached), and returns the group owning `stageId` — e.g.
 * `"micro-lesson-example-step-3"` resolves to the `prerequisite-check`
 * group without appearing in `WEB_TRANCHE6_STAGE_GROUPS` itself.
 */
export function resolveWebTranche6StageGroup(stageId: string): WebTranche6StageGroup {
  const groupByStageId = new Map(WEB_TRANCHE6_STAGE_GROUPS.map((g) => [g.groupStageId, g]));
  const orderedStageIds = [...WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.stageId);

  let current: WebTranche6StageGroup | undefined;
  for (const id of orderedStageIds) {
    const groupHead = groupByStageId.get(id);
    if (groupHead) current = groupHead;
    if (id === stageId) {
      if (!current) throw new UnknownWebTranche6StageError(stageId);
      return current;
    }
  }
  throw new UnknownWebTranche6StageError(stageId);
}

export { WEB_TRANCHE6_STAGE_GROUPS };
