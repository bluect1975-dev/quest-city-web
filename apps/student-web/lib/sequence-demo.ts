import type { SequenceDefinition } from "@quest-city-web/content-runtime";

/**
 * Demonstration-only sequence (R3C.2 §14/§16) exercising all 3 P0 engines
 * plus hints/checkpoint/non-interactive stages, reusing the same demo
 * configs as the single-engine Engine Host (`lib/engine-demo-configs.ts`).
 * NOT real M06 curriculum content — content materialization stays out of
 * scope, same posture as R3C.1's Engine Host demo.
 */
export const DEMO_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: "DEMO-SEQUENCE-R3C2",
  sequenceVersion: "1.0.0",
  stages: [
    { stageId: "intro", stageType: "INTRO_HOOK", order: 0, isInteractive: false },
    {
      stageId: "quick",
      stageType: "QUICK_QUESTION_SET",
      order: 1,
      isInteractive: true,
      activityRef: "demo-quick-question",
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 3 },
      hintPolicy: {
        maxHintLevel: 2,
        levels: [
          { level: 0, description: "nessun aiuto" },
          { level: 1, description: "rileggi le opzioni con attenzione" },
          { level: 2, description: "l'opzione corretta è la seconda" },
        ],
      },
      remediationPolicy: { triggerAfterAttempts: 3 },
    },
    {
      stageId: "drag",
      stageType: "INTERACTIVE_EXERCISE",
      order: 2,
      isInteractive: true,
      activityRef: "demo-drag-drop",
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_ANY" },
    },
    {
      stageId: "balance",
      stageType: "BALANCE_MACHINE_CHALLENGE",
      order: 3,
      isInteractive: true,
      activityRef: "demo-balance-machine",
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 3 },
      checkpointPolicy: { isCheckpoint: true },
    },
    { stageId: "result", stageType: "REFLECTION_AND_RESULT", order: 4, isInteractive: false },
  ],
};
