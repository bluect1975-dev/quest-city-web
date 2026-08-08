/**
 * Byte-equality + provenance verification and positive/negative fixture
 * coverage for the vendored R3C.2 stage-orchestration-contract schema.
 *
 * No prior vendoring instance in this repo (r3a, contracts/vendor) enforces
 * byte-equality against its own provenance.json checksum in an automated
 * test — provenance.json there is trusted at commit time only. This suite
 * closes that gap for the R3C.2 vendor entry: it re-reads the vendored file
 * from disk, recomputes SHA-256, and asserts it matches provenance.json.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateAgainst } from "./validate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, "..", "schemas", "vendor", "r3c2");

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("vendored R3C.2 stage-orchestration-contract — byte equality", () => {
  it("matches the checksum recorded in provenance.json", () => {
    const provenance = JSON.parse(
      readFileSync(join(VENDOR_DIR, "provenance.json"), "utf-8"),
    ) as {
      sourceCommit: string;
      artifacts: Array<{ name: string; checksum: string }>;
    };
    expect(provenance.sourceCommit).toBe("a77c1781184202d83eb65bfc19b7543f70fd6f9d");

    for (const artifact of provenance.artifacts) {
      const bytes = readFileSync(join(VENDOR_DIR, artifact.name));
      const actual = `sha256:${sha256Hex(bytes)}`;
      expect(actual).toBe(artifact.checksum);
    }
  });
});

describe("vendored R3C.2 stage-orchestration-contract — positive and negative fixtures", () => {
  it("accepts a well-formed SequenceDefinition", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SEQUENCE_DEFINITION",
      sequenceId: "M06-VERTICAL-SLICE",
      sequenceVersion: "1.0.0",
      stages: [
        { stageId: "intro-hook", stageType: "INTRO_HOOK", order: 0, isInteractive: false },
        {
          stageId: "quick-question-set",
          stageType: "QUICK_QUESTION_SET",
          order: 1,
          isInteractive: true,
          activityRef: "activity://m06/quick-question-set",
          engineDispatchRef: {
            resolutionMode: "RUNTIME_ADAPTER_ID",
            runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION",
          },
          progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT" },
        },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an interactive stage missing engineDispatchRef", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SEQUENCE_DEFINITION",
      sequenceId: "M06-VERTICAL-SLICE",
      sequenceVersion: "1.0.0",
      stages: [
        {
          stageId: "quick-question-set",
          stageType: "QUICK_QUESTION_SET",
          order: 0,
          isInteractive: true,
          activityRef: "activity://m06/quick-question-set",
          progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT" },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an EngineDispatchRef with RUNTIME_ADAPTER_ID mode but no runtimeAdapterId", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SEQUENCE_DEFINITION",
      sequenceId: "M06-VERTICAL-SLICE",
      sequenceVersion: "1.0.0",
      stages: [
        {
          stageId: "quick-question-set",
          stageType: "QUICK_QUESTION_SET",
          order: 0,
          isInteractive: true,
          activityRef: "activity://m06/quick-question-set",
          engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID" },
          progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT" },
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed SequenceRuntimeState", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SEQUENCE_RUNTIME_STATE",
      runtimeStateId: "rts-001",
      sequenceId: "M06-VERTICAL-SLICE",
      sequenceVersion: "1.0.0",
      currentStageId: "quick-question-set",
      stageStates: [
        {
          stageId: "intro-hook",
          status: "COMPLETED",
          hintLevel: 0,
          hintCount: 0,
          attemptsForStage: 0,
        },
        {
          stageId: "quick-question-set",
          status: "IN_PROGRESS",
          hintLevel: 1,
          hintCount: 1,
          attemptsForStage: 2,
          lastTransitionEvent: "HINT_REQUESTED",
        },
      ],
      attemptReferences: [{ stageId: "quick-question-set", attemptId: "attempt-123" }],
      sequenceCompletionState: "IN_PROGRESS",
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a StageRuntimeState with lastTransitionEvent ADVANCE_STAGE (never canonical)", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SEQUENCE_RUNTIME_STATE",
      runtimeStateId: "rts-001",
      sequenceId: "M06-VERTICAL-SLICE",
      sequenceVersion: "1.0.0",
      currentStageId: "quick-question-set",
      stageStates: [
        {
          stageId: "quick-question-set",
          status: "IN_PROGRESS",
          hintLevel: 0,
          hintCount: 0,
          attemptsForStage: 1,
          lastTransitionEvent: "ADVANCE_STAGE",
        },
      ],
      attemptReferences: [],
      sequenceCompletionState: "IN_PROGRESS",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a document matching neither SequenceDefinition nor SequenceRuntimeState", () => {
    const result = validateAgainst("r3c2StageOrchestrationContract", {
      contractType: "SOMETHING_ELSE",
    });
    expect(result.valid).toBe(false);
  });
});
