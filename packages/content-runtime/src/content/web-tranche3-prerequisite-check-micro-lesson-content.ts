import { createHash } from "node:crypto";
import type { QuickQuestionConfig, QuickQuestionItemConfig } from "@quest-city-web/learning-engines";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition, StageDefinition } from "../stage-orchestration-types";

/**
 * M06 Web Full Vertical Slice — Tranche 3 real content materialization
 * (`07_26 v1.0` §5/§13): `PREREQUISITE_CHECK` + `MICRO_LESSON`, the two
 * canonical stages (`07_13 v1.3` §4) this tranche adds. Source, read-only,
 * from `quest-city-roblox` canonical `main` @
 * `7ab2a559319694ccd4323ff3e874e8df71a5080b`:
 *  - `content/mathematics/MAT-M06/U01/L01/items/items.json` — `I001`/`I002`
 *    (`classification`, `03_33` §3 fascia D0), explicitly bound to lesson
 *    phase L2 by `03_33` §4 ("La lesson usa gli item seguenti: L2: I001,
 *    I002") and reserved for this stage by Tranche 2's own content file
 *    (`web-tranche2-quick-question-set-content.ts`, which deliberately
 *    skipped them). `I001`'s content is independently cross-confirmed by
 *    `03_15` §9 (`MAT-IT-M06-VS-001`, identical prompt/answer).
 *  - `content/mathematics/MAT-M06/U01/L01/feedback/feedback.json` —
 *    `FB-CORRECT-GENERIC`/`FB-TRY-AGAIN`, the generic feedback both items
 *    reference (`feedbackRefs`), copied verbatim.
 *  - `docs/03-mathematics/03_13_..._M06_Lesson_Package_Specification_v1_0.md`
 *    §4 (phase titles "Spiegazione visuale"/"Esempio guidato"), §5 (L3/L4
 *    script), §7 (L3 dialogue), §8 (L4 worked example, verbatim step text).
 *  - `content/mathematics/MAT-M06/U01/L01/items/items.json` — `I009`
 *    (`numeric_response`, "2x + 3 = 11" -> 4), the item `03_33` §4 binds to
 *    lesson phase L4 ("L4: I009, esempio canonico 2x + 3 = 11"), confirming
 *    the worked example's numbers.
 *
 * PREREQUISITE_CHECK engine mapping (evidence, not assumption, per this
 * authorization's §6): `02_36` §20-bis.2 — "un comportamento è un Learning
 * Engine... soltanto se possiede una responsabilità pedagogico-interattiva
 * autonoma". `I001`/`I002` are graded, validated classification items
 * (`answerValidator.type: "deterministic"`) — an autonomous interaction
 * capability exactly like Tranche 2's `QUICK_QUESTION_SET` items. `07_10`
 * §7 confirms `ENG-QUICK` "Supporta scelta..." (choice-type items) — the
 * same `OPTION_SELECTION` capability already used for `I003`/`I004`.
 * Mapped to `ENG-QUICK`'s existing `ITEM_SET` mode (Tranche 2), reused
 * as-is with 2 items instead of 6 — no new engine, no new config mode
 * (`quick-question-engine.ts` `ITEM_SET` validates `items.length >= 1`,
 * no floor at 3 — that was Tranche 2's own content choice, not an engine
 * constraint).
 *
 * MICRO_LESSON architecture (evidence, not assumption, per this
 * authorization's §8): the L3/L4 content has no graded student answer —
 * `03_13` §8's own instruction is "la UI mostra un solo passaggio per
 * volta. Il passaggio successivo resta nascosto fino alla conferma del
 * precedente" (pure sequential reveal, no correctness to validate). Per
 * `02_36` §20-bis.2's same rule, a stage with no autonomous validated
 * interaction capability belongs to the orchestration layer, not the
 * Engine Registry — matching `07_26` §5/§6's own classification
 * ("Non applicabile... probabile orchestration layer"). `MicroLessonEngine`
 * is explicitly prohibited by this authorization's §8 ("NON creare").
 *
 * Implementation of the step-reveal (evidence, not assumption):
 * `schemas/vendor/r3c2/stage-orchestration-contract.schema.json`'s
 * `StageRuntimeState` definition is closed (`additionalProperties: false`,
 * fields limited to `hintLevel`/`hintCount`/`attemptsForStage`/
 * `checkpointReached`/`remediationTriggered`/`lastTransitionEvent`) — there
 * is no free slot to carry an arbitrary "current step index" for a single
 * multi-step stage without modifying the canonical schema, which this
 * authorization forbids (`quest-city-roblox` is read-only). `StageType` is
 * documented in that same schema as "deliberately not a closed enum" and
 * `stages[]` carries no uniqueness constraint on `stageType` — so each of
 * `03_13` §8's six worked-example lines (plus the L3 equilibrium
 * explanation) is instead modeled as its own orchestrator `StageDefinition`
 * (all `stageType: "MICRO_LESSON"`, `isInteractive: false`), reusing the
 * exact, already-durable `advanceStage`/`currentStageId` mechanism proven
 * since `R3C.3` for `REFLECTION_AND_RESULT` — no new persistence code, no
 * canonical schema change, and durable mid-lesson resume comes for free
 * from infrastructure that already exists. This mirrors, for a non-engine
 * stage, the same "extend `stages[]`, don't rewrite infrastructure"
 * principle `07_26` §4 already applies to engine-backed stages.
 */

export const WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID = "d4a8f2b6-1e9c-4a7d-8b3f-5c6e9a2d7f14";
export const WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID = "MAT-M06-U01-prerequisite-check";
export const WEB_TRANCHE3_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche3_prerequisite_check_micro_lesson";
export const WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche3_prerequisite_check_micro_lesson";

/**
 * `content/mathematics/MAT-M06/U01/L01/items/items.json` (I001, I002) +
 * `feedback/feedback.json` (`FB-CORRECT-GENERIC`, `FB-TRY-AGAIN`), all text
 * copied verbatim. `I001`'s `solutionExplanation` is its own `rationale`
 * field; `I002` has no canonical rationale, so none is set (not invented).
 */
const WEB_TRANCHE3_PREREQUISITE_CHECK_ITEMS: QuickQuestionItemConfig[] = [
  {
    itemId: "MAT-M06-U01-I001",
    mode: "OPTION_SELECTION",
    prompt: "Quale tra queste scritture è un'equazione?",
    options: [
      { optionId: "A", text: "x + 4 = 9" },
      { optionId: "B", text: "x + 4" },
      { optionId: "C", text: "9" },
      { optionId: "D", text: "x" },
    ],
    correctOptionId: "A",
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      incorrectFeedbackText: "Riprova osservando l'operazione più vicina alla x.",
      solutionExplanation: "Un'equazione contiene un'uguaglianza tra due espressioni.",
    },
  },
  {
    itemId: "MAT-M06-U01-I002",
    mode: "OPTION_SELECTION",
    prompt: "Quale scrittura non è un'equazione?",
    options: [
      { optionId: "A", text: "2x = 10" },
      { optionId: "B", text: "x - 3 = 7" },
      { optionId: "C", text: "4x + 1" },
      { optionId: "D", text: "5 = x + 2" },
    ],
    correctOptionId: "C",
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      incorrectFeedbackText: "Riprova osservando l'operazione più vicina alla x.",
    },
  },
];

export const WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG: QuickQuestionConfig = {
  mode: "ITEM_SET",
  items: WEB_TRANCHE3_PREREQUISITE_CHECK_ITEMS,
};

export const WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_DEFINITION = {
  activityId: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
  activityVersion: "1.0.0",
  subjectId: "MAT",
  moduleId: "MAT-M06",
  unitId: "MAT-M06-U01",
  sourceLessonId: "MAT-M06-U01-L01",
  sourceItemIds: WEB_TRANCHE3_PREREQUISITE_CHECK_ITEMS.map((item) => item.itemId),
  objectiveIds: ["MAT.ALG.EQ1-K"],
  validatorRef: "deterministic-option-match",
  evidenceRef: "web-tranche3-prerequisite-check-evidence",
  outcomePolicyRef: "web-tranche3-prerequisite-check-outcome",
  semanticRoles: ["question-prompt", "option", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "7ab2a559319694ccd4323ff3e874e8df71a5080b",
    sourceDocuments: [
      "content/mathematics/MAT-M06/U01/L01/items/items.json#I001,I002",
      "content/mathematics/MAT-M06/U01/L01/feedback/feedback.json#FB-CORRECT-GENERIC,FB-TRY-AGAIN",
      "docs/03-mathematics/03_33_Quest_City_Mathematics_M06_U01_Executable_Content_Package_v1_1.md#4-binding-della-lesson",
      "docs/03-mathematics/03_15_Quest_City_Mathematics_Vertical_Slice_Question_and_Item_Pack_v1_0.md#9-item-baseline-definitivi",
      "docs/07-web-learing-platform/07_26_Quest_City_Web_M06_Full_Vertical_Slice_Canonical_Completion_Definition_v1_0.md#5",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_DEFINITION);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche3-prerequisite-check-micro-lesson-v1",
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
      entryId: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
      entryType: "activity",
      path: `activities/${WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

export const WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID = "prerequisite-check";

/**
 * `03_13` §4 phase titles ("Spiegazione visuale" for L3, "Esempio guidato"
 * for L4) reused verbatim as stage prompt titles. Body text for the
 * equilibrium stage combines the L3 script (§5) and dialogue (§7),
 * verbatim, both attributed to the same phase. Body text for the six
 * worked-example stages is `03_13` §8's own six lines, split one per
 * stage (no line altered, none merged, none invented) — exactly matching
 * §8's own instruction that only one line is shown at a time.
 */
export const WEB_TRANCHE3_MICRO_LESSON_STEPS: Array<{ stageId: string; titleText: string; bodyText: string }> = [
  {
    stageId: "micro-lesson-equilibrium",
    titleText: "Spiegazione visuale",
    bodyText:
      "Bilancia visuale con x + 3 a sinistra e 7 a destra. Sottrai 3 da entrambi i lati. Pensa a una bilancia: togliere tre da un solo piatto rompe l'equilibrio. Togli tre da entrambi.",
  },
  { stageId: "micro-lesson-example-step-1", titleText: "Esempio guidato", bodyText: "2x + 3 = 11" },
  { stageId: "micro-lesson-example-step-2", titleText: "Esempio guidato", bodyText: "2x + 3 - 3 = 11 - 3" },
  { stageId: "micro-lesson-example-step-3", titleText: "Esempio guidato", bodyText: "2x = 8" },
  { stageId: "micro-lesson-example-step-4", titleText: "Esempio guidato", bodyText: "2x / 2 = 8 / 2" },
  { stageId: "micro-lesson-example-step-5", titleText: "Esempio guidato", bodyText: "x = 4" },
  { stageId: "micro-lesson-example-step-6", titleText: "Esempio guidato", bodyText: "Verifica: 2(4) + 3 = 11 → 8 + 3 = 11" },
];

const microLessonStageDefinitions: StageDefinition[] = WEB_TRANCHE3_MICRO_LESSON_STEPS.map((step, index) => ({
  stageId: step.stageId,
  stageType: "MICRO_LESSON",
  order: index + 1,
  isInteractive: false,
}));

/**
 * i18n key mapping for `SequenceHost`'s `stagePrompts` prop, one entry per
 * `MICRO_LESSON` sub-stage — text content matches `WEB_TRANCHE3_MICRO_LESSON_STEPS`
 * verbatim (see `packages/i18n/src/locales/it-IT/student-web.json`
 * `prerequisiteCheckMicroLesson.*`).
 */
export const WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS: Record<string, { titleKey: string; bodyKey: string }> = {
  "micro-lesson-equilibrium": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonEquilibriumTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonEquilibriumBody",
  },
  "micro-lesson-example-step-1": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep1Body",
  },
  "micro-lesson-example-step-2": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep2Body",
  },
  "micro-lesson-example-step-3": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep3Body",
  },
  "micro-lesson-example-step-4": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep4Body",
  },
  "micro-lesson-example-step-5": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep5Body",
  },
  "micro-lesson-example-step-6": {
    titleKey: "prerequisiteCheckMicroLesson.microLessonExampleTitle",
    bodyKey: "prerequisiteCheckMicroLesson.microLessonExampleStep6Body",
  },
};

/**
 * Two-stage-group sequence (`07_13` §4 canonical `stageType` values):
 * `PREREQUISITE_CHECK` (order 0, dispatches to `ENG-QUICK`'s `ITEM_SET`
 * mode) followed by seven `MICRO_LESSON` sub-stages (orders 1-7, all
 * non-interactive, one per `03_13` §5/§7/§8 content unit) — matching
 * `07_13` §4's canonical order (`PREREQUISITE_CHECK` before
 * `MICRO_LESSON`). `progressionRule` for `PREREQUISITE_CHECK` uses
 * `ON_ENGINE_EVALUATION_ANY` (not `..._CORRECT`), matching `07_13` §6's
 * non-punitive requirement already applied identically in Tranche 2 —
 * `PREREQUISITE_CHECK` is a readiness check, not a graded gate.
 */
export const WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche3-${WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
      stageType: "PREREQUISITE_CHECK",
      order: 0,
      isInteractive: true,
      activityRef: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_ANY" },
      checkpointPolicy: { isCheckpoint: true },
    },
    ...microLessonStageDefinitions,
  ],
};
