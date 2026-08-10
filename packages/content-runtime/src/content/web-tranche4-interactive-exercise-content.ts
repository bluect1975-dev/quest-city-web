import { createHash } from "node:crypto";
import type { DragDropConfig } from "@quest-city-web/learning-engines";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition } from "../stage-orchestration-types";

/**
 * M06 Web Full Vertical Slice — Tranche 4 real content materialization
 * (`07_26 v1.0` §5/§6/§7/§13/§22-Tranche-4): `INTERACTIVE_EXERCISE`, the
 * one canonical stage (`07_13 v1.3` §4/§8) this tranche adds. Source,
 * read-only, from `quest-city-roblox` canonical `main` @
 * `d867c897e7375059911521f5d855e04f6c405441`:
 *  - `docs/03-mathematics/03_35_..._Interactive_Exercises_Quest_and_Challenge_Package_Specification_v1_1.md`
 *    §17.1 — `MAT-M06-U01-IE001`'s full prescriptive behavior, copied
 *    verbatim, nothing invented: "osservare x + 3 = 7 come equilibrio;
 *    selezionare l'operazione -3; applicarla a entrambi i membri;
 *    visualizzare la trasformazione x = 4; verificare la soluzione;
 *    ricevere feedback specifico se modifica un solo membro." §6.6 supplies
 *    the "unilateral error" distinction reused for `feedback.partialFeedbackText`
 *    below. `07_26` §5/§7 confirms this package was specified but never
 *    produced as an executable inventory entry (`03_33` §2) before this
 *    tranche — this file is that first production, not a redefinition.
 *  - `docs/07-web-learing-platform/07_13_..._v1_3.md` §8 — "L'esercizio può
 *    usare drag-and-drop, selezione-destinazione o input numerico.
 *    L'alternativa accessibile deve produrre le stesse semantic action" —
 *    satisfied by `ENG-DRAG`'s existing select-source-then-destination
 *    fallback (`DragAndDropView.tsx`), the only interaction path, already
 *    identical in semantic-action shape to a pointer drag.
 *  - `docs/07-web-learing-platform/07_26_..._v1_0.md` §5/§6 — engine
 *    candidates named for this stage are `ENG-DRAG` or `ENG-QUICK`/adapter;
 *    `ENG-DRAG` selected here (not `ENG-QUICK`) because only its
 *    item->target placement model can represent *which* member (left/right)
 *    was modified, which `03_35` §17.1 point 6 requires the exercise to
 *    react to specifically — `ENG-QUICK`'s single-answer model has no
 *    concept of a second, independently-trackable target. Classified
 *    `SUPPORTED` (`02_36` §3/§8): a direct, backward-compatible
 *    configuration extension of the existing `ACTIVE` `ENG-DRAG` engine
 *    (optional `text`/`feedback` fields), not a new engine, not a
 *    `SUPPORTED_WITH_CONFIGURATION` outcome (that value does not exist in
 *    `02_36`'s 4-outcome vocabulary).
 *
 * Content model: `x + 3 = 7` requires subtracting 3 from both members to
 * isolate `x = 4` (`03_35` §17.1's own worked numbers). Represented as two
 * placement slots — one per member — both carrying the same operation
 * "−3", since `DragDropState.placements` is item-keyed (one target per
 * item) and cannot represent one item mapped to two targets at once. This
 * is a direct structural transcription of the canonical behavior, not
 * invented content: the two slots are exactly "apply −3 to the left
 * member" and "apply −3 to the right member" from §17.1 points 2-3.
 * `evidence.matchedCount` (0/1/2 out of 2) is what the engine already
 * produces from these two placements — the "unilateral" feedback
 * (`partialFeedbackText`) fires exactly when `matchedCount === 1`, i.e.
 * exactly one member was modified, matching §17.1 point 6 and reusing the
 * same misconception phrasing already registered for the equivalent
 * concept in Tranche 2 (`MAT.MIS.ALG.001`, `web-tranche2-...ts`).
 */

export const WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID = "e1a4c9f0-6b3d-4e2a-8f71-2d5c8a9b0e17";
export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID = "MAT-M06-U01-IE001";
export const WEB_TRANCHE4_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche4_interactive_exercise";
export const WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche4_interactive_exercise";

const LEFT_MEMBER_TARGET_ID = "left-member";
const RIGHT_MEMBER_TARGET_ID = "right-member";
const APPLY_LEFT_ITEM_ID = "apply-minus-3-left";
const APPLY_RIGHT_ITEM_ID = "apply-minus-3-right";

export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG: DragDropConfig = {
  items: [
    { itemId: APPLY_LEFT_ITEM_ID, text: "−3" },
    { itemId: APPLY_RIGHT_ITEM_ID, text: "−3" },
  ],
  targets: [
    { targetId: LEFT_MEMBER_TARGET_ID, text: "x + 3" },
    { targetId: RIGHT_MEMBER_TARGET_ID, text: "7" },
  ],
  correctMapping: [
    { itemId: APPLY_LEFT_ITEM_ID, targetId: LEFT_MEMBER_TARGET_ID },
    { itemId: APPLY_RIGHT_ITEM_ID, targetId: RIGHT_MEMBER_TARGET_ID },
  ],
  feedback: {
    correctFeedbackText: "Corretto. Hai applicato l'operazione a entrambi i membri: x = 4.",
    partialFeedbackText: "Hai modificato un solo membro. Applica la stessa operazione anche all'altro membro.",
    incorrectFeedbackText: "Riprova: applica l'operazione -3 a entrambi i membri dell'equazione.",
  },
};

export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_DEFINITION = {
  activityId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
  activityVersion: "1.0.0",
  subjectId: "MAT",
  moduleId: "MAT-M06",
  unitId: "MAT-M06-U01",
  sourceLessonId: "MAT-M06-U01-L01",
  sourceItemIds: [WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID],
  objectiveIds: ["MAT.ALG.EQ1-R", "MAT.ALG.EQ1-P"],
  validatorRef: "deterministic-exact-mapping-match",
  evidenceRef: "web-tranche4-interactive-exercise-evidence",
  outcomePolicyRef: "web-tranche4-interactive-exercise-outcome",
  semanticRoles: ["exercise-prompt", "drag-item", "drop-target", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "d867c897e7375059911521f5d855e04f6c405441",
    sourceDocuments: [
      "docs/03-mathematics/03_35_Quest_City_Mathematics_Interactive_Exercises_Quest_and_Challenge_Package_Specification_v1_1.md#17.1-esercizio-interattivo",
      "docs/03-mathematics/03_35_Quest_City_Mathematics_Interactive_Exercises_Quest_and_Challenge_Package_Specification_v1_1.md#6.6-errori-hint-e-reset",
      "docs/07-web-learing-platform/07_13_Quest_City_Web_M06_Executable_Lesson_and_Activity_Package_Specification_v1_3.md#8-interactive-exercise",
      "docs/07-web-learing-platform/07_26_Quest_City_Web_M06_Full_Vertical_Slice_Canonical_Completion_Definition_v1_0.md#5-6-13",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_DEFINITION);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche4-interactive-exercise-v1",
  bundleVersion: "1.0.0",
  bundleType: "ACTIVITY_BUNDLE" as const,
  status: "PUBLISHED" as const,
  subjectId: "MAT",
  moduleId: "MAT-M06",
  contentVersion: "1.0.0",
  publishedAt: "2026-08-10T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html", "keyboard"],
  fallbacksDeclared: true,
  entries: [
    {
      entryId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
      entryType: "activity",
      path: `activities/${WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID = "interactive-exercise";

/**
 * One-stage sequence (`07_13` §4 canonical `stageType`): `INTERACTIVE_EXERCISE`
 * dispatches to `ENG-DRAG` through the existing Stage/Session Orchestrator,
 * the same pattern `WEB_M4_ACTIVITY_SEQUENCE_DEFINITION`/
 * `WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION` established — no
 * second persistence mechanism, no new orchestrator code. `progressionRule`
 * uses `ON_ENGINE_EVALUATION_CORRECT` with `maxAttemptsBeforeRemediation: 5`
 * (identical to `WEB_M4_ACTIVITY_SEQUENCE_DEFINITION`'s `BALANCE_MACHINE_CHALLENGE`
 * stage) rather than `QUICK_QUESTION_SET`'s non-punitive `..._ANY`: `03_35`
 * §17.1 point 5 ("verificare la soluzione") frames this as a
 * mastery-demonstration exercise the student must actually get right, not
 * a low-stakes formative check — the student can `RESET_STAGE` and retry
 * using the feedback (including the unilateral-error case) already
 * available. Only one stage exists in this tranche's slice — completing it
 * completes the sequence, matching `07_26` §12 without anticipating
 * Tranche 5-6 stages or unifying this with WEB-M4/Tranche 1-3's separate
 * sequences.
 */
export const WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche4-${WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
      stageType: "INTERACTIVE_EXERCISE",
      order: 0,
      isInteractive: true,
      activityRef: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 5 },
      checkpointPolicy: { isCheckpoint: true },
    },
  ],
};
