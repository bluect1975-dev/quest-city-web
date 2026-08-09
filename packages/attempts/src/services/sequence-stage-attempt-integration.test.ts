import { initializeSequence, type SequenceDefinition } from "@quest-city-web/content-runtime";
import { describe, expect, it } from "vitest";
import { recordStageAttempt } from "./sequence-stage-attempt-integration";
import type { LearningAttempt } from "../repository/learning-attempt-repository";

const DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: "SEQ-1",
  sequenceVersion: "1.0.0",
  stages: [{ stageId: "s1", stageType: "INTRO_HOOK", order: 0, isInteractive: false }],
};

const FAKE_ATTEMPT: LearningAttempt = {
  id: "attempt-abc",
  tenantId: "tenant-1",
  eventId: "event-1",
  assignmentId: "assignment-1",
  studentProfileId: "student-1",
  enrollmentId: "enrollment-1",
  contentBundleId: "bundle-1",
  contentId: "content-1",
  contentVersion: "1.0.0",
  sessionId: null,
  attemptState: "COMPLETED",
  completionStatus: "CONSOLIDATED",
  startedAt: new Date("2026-08-08T00:00:00.000Z"),
  completedAt: new Date("2026-08-08T00:05:00.000Z"),
  outcome: { correctness: "CORRECT" },
  runtimeChannel: "WEB",
  runtimeVersion: null,
  presentationAdapterVersion: null,
  themeId: null,
  validatorVersion: null,
  creationIdempotencyKey: "idem-1",
};

describe("recordStageAttempt", () => {
  it("records only {stageId, attemptId} — never leaks attemptState/completionStatus", () => {
    const state = initializeSequence(DEFINITION, "rts-1");
    const next = recordStageAttempt(state, "s1", FAKE_ATTEMPT);
    expect(next.attemptReferences).toEqual([{ stageId: "s1", attemptId: "attempt-abc" }]);
    expect(next).not.toHaveProperty("attemptState");
    expect(next).not.toHaveProperty("completionStatus");
  });

  it("accepts any object exposing just an id (structural narrowing)", () => {
    const state = initializeSequence(DEFINITION, "rts-1");
    const next = recordStageAttempt(state, "s1", { id: "attempt-xyz" });
    expect(next.attemptReferences).toEqual([{ stageId: "s1", attemptId: "attempt-xyz" }]);
  });
});
