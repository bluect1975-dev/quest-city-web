import { createHash } from "node:crypto";
import type { QuickQuestionConfig, QuickQuestionItemConfig } from "@quest-city-web/learning-engines";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition } from "../stage-orchestration-types";

/**
 * M06 Web Full Vertical Slice — Tranche 2 real content materialization
 * (`07_26 v1.0` §16/§22-Tranche-2): `QUICK_QUESTION_SET`, the one
 * canonical stage (`07_13 v1.3` §4/§6) this tranche adds. Source,
 * read-only, from `quest-city-roblox` canonical `main` @
 * `7ab2a559319694ccd4323ff3e874e8df71a5080b`:
 *  - `content/mathematics/MAT-M06/U01/L01/items/items.json` — the real
 *    executable item catalog (`03_33` §2 "Inventario eseguibile"), 24
 *    items `MAT-M06-U01-I001`..`I024`. Items I003/I004 (`operation_choice`,
 *    `03_33` §3 fascia D0) and I006/I007/I009/I010 (`numeric_response`,
 *    fascia D1) are used here — the exact prompt/choice/answer text below
 *    is copied verbatim from that file, nothing invented.
 *  - `content/mathematics/MAT-M06/U01/L01/feedback/feedback.json` —
 *    `FB-ALG-001`/`FB-ALG-002` misconception feedback text, copied
 *    verbatim, for I003's two wrong choices.
 *  - `docs/03-mathematics/03_15_..._Question_and_Item_Pack_v1_0.md` §9/§11
 *    — the same items' canonical `solution.steps`-equivalent hint ladder,
 *    used here only as the `solutionExplanation` shown on a wrong
 *    ENTER_VALUE answer (I006/I007/I009/I010 have no per-choice
 *    misconception in `items.json`, so the worked solution from the item's
 *    own `solution.steps` array is what is shown instead of guessing which
 *    misconception applied).
 *  - `docs/07-web-learing-platform/07_26_..._v1_0.md` §16/§22 — Tranche 2
 *    handoff, naming `ENG-QUICK` explicitly for `QUICK_QUESTION_SET`.
 *
 * Item selection (documented, not silent): `07_26` §16 offers "10 item
 * base (03_15 §9) o sottoinsieme di I001-I024 (03_33 §3)". `I001`/`I002`
 * (`classification`) are explicitly named by `07_26` §16 as candidates for
 * the future `PREREQUISITE_CHECK` stage (Tranche 3, out of scope here) —
 * reusing them here would preempt that stage's own content decision, so
 * this tranche instead uses `I003`/`I004` (`operation_choice`, same D0
 * fascia, not earmarked for any other stage) plus four `numeric_response`
 * items (`I006`/`I007`/`I009`/`I010`) from fascia D1, six items total —
 * comfortably above `07_13` §6's "almeno tre item rappresentativi" floor
 * and spanning both item types `07_26` §16 names for this stage. `I005`
 * (`numeric_response`, "x + 5 = 12" -> 7) is intentionally skipped: it is
 * the exact equation/answer Tranche 1's `GUIDED_PRACTICE` stage already
 * uses (`03_13` §9 `PR-M06-L01-01`), and reusing it verbatim here would be
 * a redundant duplicate rather than a distinct quick-check item.
 *
 * Item-set model: `QUICK_QUESTION_SET` stays one canonical stage with one
 * `engineDispatchRef`/one evaluation cycle — the set of items is carried
 * entirely inside `ENG-QUICK`'s own `ITEM_SET` config mode
 * (`quick-question-engine.ts`), not as N orchestrator stages. Progression
 * uses `ON_ENGINE_EVALUATION_ANY` (advance once every item has been
 * answered, regardless of correctness) — `07_13` §6's "nessuna penalità
 * economica per il primo errore" / "domande rapide non punitive": the set
 * is a low-stakes formative check, not a gate the student must get 100%
 * correct to pass.
 */

export const WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID = "c92f4a17-3e8d-4b1a-9c72-8f5e6a9d3b04";
export const WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID = "MAT-M06-U01-quick-question-set";
export const WEB_TRANCHE2_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche2_quick_question_set";
export const WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche2_quick_question_set";

/**
 * `content/mathematics/MAT-M06/U01/L01/items/items.json` (I003, I004,
 * I006, I007, I009, I010) + `feedback/feedback.json` (`FB-ALG-001`,
 * `FB-ALG-002`), all text copied verbatim. `solutionExplanation` for the
 * numeric items is the item's own `solution.steps` joined, since those
 * items carry no per-choice misconception to select from.
 */
const WEB_TRANCHE2_QUICK_QUESTION_SET_ITEMS: QuickQuestionItemConfig[] = [
  {
    itemId: "MAT-M06-U01-I003",
    mode: "OPTION_SELECTION",
    prompt: "Per mantenere l'equilibrio in x + 5 = 12, quale operazione applichi?",
    options: [
      { optionId: "A", text: "Sottraggo 5 solo a sinistra" },
      { optionId: "B", text: "Sottraggo 5 a entrambi i membri" },
      { optionId: "C", text: "Aggiungo 5 a entrambi i membri" },
      { optionId: "D", text: "Divido entrambi i membri per 5" },
    ],
    correctOptionId: "B",
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      incorrectFeedbackText: "Riprova osservando l'operazione più vicina alla x.",
      misconceptions: [
        { matchChoiceId: "A", code: "MAT.MIS.ALG.001", feedbackText: "Hai modificato un solo membro. Applica la stessa operazione anche all'altro membro." },
        { matchChoiceId: "C", code: "MAT.MIS.ALG.002", feedbackText: "Non basta spostare un termine cambiandone il segno. Mostra l'operazione equivalente sui due membri." },
      ],
    },
  },
  {
    itemId: "MAT-M06-U01-I004",
    mode: "OPTION_SELECTION",
    prompt: "In 3x = 15, quale operazione isola x?",
    options: [
      { optionId: "A", text: "Sottraggo 3" },
      { optionId: "B", text: "Aggiungo 3" },
      { optionId: "C", text: "Moltiplico per 3" },
      { optionId: "D", text: "Divido entrambi i membri per 3" },
    ],
    correctOptionId: "D",
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      incorrectFeedbackText: "Riprova osservando l'operazione più vicina alla x.",
      misconceptions: [
        { matchChoiceId: "A", code: "MAT.MIS.ALG.003", feedbackText: "La divisione deve riguardare entrambi i membri dell'equazione." },
      ],
    },
  },
  {
    itemId: "MAT-M06-U01-I006",
    mode: "ENTER_VALUE",
    prompt: "Risolvi: x - 4 = 9",
    expectedValue: 13,
    tolerance: 0,
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      solutionExplanation: "x - 4 + 4 = 9 + 4, quindi x = 13.",
    },
  },
  {
    itemId: "MAT-M06-U01-I007",
    mode: "ENTER_VALUE",
    prompt: "Risolvi: 3x = 18",
    expectedValue: 6,
    tolerance: 0,
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      solutionExplanation: "3x / 3 = 18 / 3, quindi x = 6.",
    },
  },
  {
    itemId: "MAT-M06-U01-I009",
    mode: "ENTER_VALUE",
    prompt: "Risolvi: 2x + 3 = 11",
    expectedValue: 4,
    tolerance: 0,
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      solutionExplanation: "2x + 3 - 3 = 11 - 3, quindi 2x = 8 e x = 4.",
    },
  },
  {
    itemId: "MAT-M06-U01-I010",
    mode: "ENTER_VALUE",
    prompt: "Risolvi: 3x - 4 = 11",
    expectedValue: 5,
    tolerance: 0,
    feedback: {
      correctFeedbackText: "Corretto. Hai mantenuto l'equilibrio tra i due membri.",
      solutionExplanation: "3x - 4 + 4 = 11 + 4, quindi 3x = 15 e x = 5.",
    },
  },
];

export const WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG: QuickQuestionConfig = {
  mode: "ITEM_SET",
  items: WEB_TRANCHE2_QUICK_QUESTION_SET_ITEMS,
};

export const WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_DEFINITION = {
  activityId: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
  activityVersion: "1.0.0",
  subjectId: "MAT",
  moduleId: "MAT-M06",
  unitId: "MAT-M06-U01",
  sourceLessonId: "MAT-M06-U01-L01",
  sourceItemIds: WEB_TRANCHE2_QUICK_QUESTION_SET_ITEMS.map((item) => item.itemId),
  objectiveIds: ["MAT.ALG.EQ1-R", "MAT.ALG.EQ1-P"],
  validatorRef: "deterministic-option-match+deterministic-numeric-tolerance",
  evidenceRef: "web-tranche2-quick-question-set-evidence",
  outcomePolicyRef: "web-tranche2-quick-question-set-outcome",
  semanticRoles: ["question-prompt", "option", "value-input", "confirm-button"],
  capabilityRequirements: ["html", "keyboard"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "7ab2a559319694ccd4323ff3e874e8df71a5080b",
    sourceDocuments: [
      "content/mathematics/MAT-M06/U01/L01/items/items.json#I003,I004,I006,I007,I009,I010",
      "content/mathematics/MAT-M06/U01/L01/feedback/feedback.json#FB-ALG-001,FB-ALG-002",
      "docs/03-mathematics/03_15_Quest_City_Mathematics_Vertical_Slice_Question_and_Item_Pack_v1_0.md#9-item-baseline-definitivi",
      "docs/07-web-learing-platform/07_13_Quest_City_Web_M06_Executable_Lesson_and_Activity_Package_Specification_v1_3.md#6-quick-question-set",
      "docs/07-web-learing-platform/07_26_Quest_City_Web_M06_Full_Vertical_Slice_Canonical_Completion_Definition_v1_0.md#16",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_DEFINITION);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche2-quick-question-set-v1",
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
      entryId: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
      entryType: "activity",
      path: `activities/${WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

export const WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID = "quick-question-set";

/**
 * One-stage sequence (`07_13` §4 canonical `stageType`): `QUICK_QUESTION_SET`
 * dispatches to `ENG-QUICK` (`ITEM_SET` config mode) through the existing
 * Stage/Session Orchestrator, exactly the pattern
 * `WEB_M4_ACTIVITY_SEQUENCE_DEFINITION`/`WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION`
 * established — no second persistence mechanism, no new orchestrator
 * code, no per-item orchestrator stage. `progressionRule` uses
 * `ON_ENGINE_EVALUATION_ANY` (not `..._CORRECT`): the stage advances once
 * the whole item set has been answered, regardless of aggregate
 * correctness, matching `07_13` §6's non-punitive requirement — this also
 * makes `maxAttemptsBeforeRemediation` structurally unreachable
 * (`stage-orchestrator.ts` `receiveEngineResult`: the `ON_ENGINE_EVALUATION_ANY`
 * branch always short-circuits to `ADVANCED` before the remediation check
 * is reached), so it is intentionally omitted rather than set to an inert
 * value. Only one stage exists in this tranche's slice — completing it
 * completes the sequence, matching §12 of the authorization ("progression
 * state reale", "SequenceRuntimeState riflette il progresso") without
 * anticipating Tranche 3-6 stages or a second Reflection experience beyond
 * the one Tranche 1 already implements for its own sequence.
 */
export const WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche2-${WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
      stageType: "QUICK_QUESTION_SET",
      order: 0,
      isInteractive: true,
      activityRef: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_ANY" },
      checkpointPolicy: { isCheckpoint: true },
    },
  ],
};
