import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SequenceHost } from "./SequenceHost";
import { setStoredCsrfToken } from "../../lib/session-client";
import { notifyOrchestrationStageEntry } from "../../lib/student-api-client";
import {
  WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
  WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
  WEB_TRANCHE5_INTRO_HOOK_CONTENT,
  WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
} from "@quest-city-web/content-runtime";

vi.mock("../../lib/student-api-client", () => ({
  notifyOrchestrationStageEntry: vi.fn().mockResolvedValue({ attemptId: "attempt-test-1", attemptState: "IN_PROGRESS" }),
}));

/**
 * M06 Web Full Vertical Slice Tranche 1 (`07_26 v1.0` §14): exercises
 * `SequenceHost`'s Tranche-1-motivated additions (`stagePrompts`,
 * `recapStageId`, hint-content rendering) against the real 2-stage
 * `GUIDED_PRACTICE` -> `REFLECTION_AND_RESULT` sequence — no CSRF token is
 * stored in this jsdom environment, so `SequenceHost` falls back to its
 * pre-existing pure-`useState` in-memory mode (same fallback WEB-M4's own
 * tests already rely on), keeping this a fast, dependency-free unit test.
 */
const STAGE_CONFIGS = { [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG };
const STAGE_PROMPTS = {
  [WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID]: { titleKey: "guidedPractice.promptTitle", bodyKey: "guidedPractice.promptEquation" },
};

function renderTranche1Sequence(onComplete?: () => void) {
  return render(
    <SequenceHost
      definition={WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION}
      runtimeStateId="test-tranche1-runtime"
      stageConfigs={STAGE_CONFIGS}
      stagePrompts={STAGE_PROMPTS}
      recapStageId={WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID}
      titleKey="guidedPractice.sequenceTitle"
      descriptionKey="guidedPractice.sequenceDescription"
      {...(onComplete ? { onComplete } : {})}
    />,
  );
}

describe("SequenceHost — Tranche 1 Guided Practice + Reflection/Result", () => {
  it("renders the stage prompt (equation) above the ENG-QUICK input for GUIDED_PRACTICE", async () => {
    renderTranche1Sequence();
    expect(await screen.findByText("Risolvi l'equazione")).toBeInTheDocument();
    expect(screen.getByText("x + 5 = 12")).toBeInTheDocument();
  });

  it("REQUEST_HINT reveals the real hint text (H1, 03_13 §11) and increments the level", async () => {
    renderTranche1Sequence();
    await screen.findByText("x + 5 = 12");
    fireEvent.click(screen.getByRole("button", { name: "Richiedi un aiuto" }));
    expect(await screen.findByText("Aiuto: Quale operazione annulla il termine che vuoi eliminare?")).toBeInTheDocument();
    expect(screen.getByText("Livello aiuto: 1 di 4")).toBeInTheDocument();
  });

  it("a wrong answer retries (no stage advance), a correct answer (x = 7) advances to REFLECTION_AND_RESULT with a checkpoint recap, and continuing completes the sequence", async () => {
    const onComplete = vi.fn();
    renderTranche1Sequence(onComplete);
    await screen.findByText("x + 5 = 12");

    const input = screen.getByLabelText("Inserisci un valore numerico") as HTMLInputElement;

    // Wrong answer first.
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));
    expect(await screen.findByText("Da rivedere")).toBeInTheDocument();
    expect(screen.getByText("x + 5 = 12")).toBeInTheDocument(); // still on GUIDED_PRACTICE

    // Correct answer.
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    // Advanced to REFLECTION_AND_RESULT: recap of the GUIDED_PRACTICE stage renders, prompt no longer does.
    expect(await screen.findByText("Riepilogo della pratica")).toBeInTheDocument();
    expect(screen.getByText("Tentativi su questo stage: 2")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint raggiunto.")).toBeInTheDocument();
    expect(screen.queryByText("x + 5 = 12")).not.toBeInTheDocument();

    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));
    expect(await screen.findByText("Sequenza completata.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

/**
 * M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §16): the real
 * QUICK_QUESTION_SET stage, driven end-to-end through the actual
 * `SequenceHost` -> `EngineHost` pipeline (not a hand-built orchestrator
 * state, unlike the content-runtime unit tests) — this is the regression
 * guard for the bug the browser walkthrough caught: `EngineHost` used to
 * forward every `engine.evaluate()` result to the orchestrator
 * unconditionally, including `evaluated: false` ("SET_IN_PROGRESS") — with
 * `ON_ENGINE_EVALUATION_ANY`, that completed the stage after the very
 * first item instead of after all 6.
 */
const TR2_STAGE_CONFIGS = { [WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID]: WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG };

describe("SequenceHost — Tranche 2 Quick Question Set (real 6-item ITEM_SET, no premature completion)", () => {
  it("does not complete the sequence after only the first item is confirmed", async () => {
    const onComplete = vi.fn();
    render(
      <SequenceHost
        definition={WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche2-runtime"
        stageConfigs={TR2_STAGE_CONFIGS}
        titleKey="quickQuestionSet.sequenceTitle"
        descriptionKey="quickQuestionSet.sequenceDescription"
        onComplete={onComplete}
      />,
    );
    expect(await screen.findByText("Domanda 1 di 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sottraggo 5 a entrambi i membri" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    // Item 2 renders — the stage/sequence is still in progress, not completed.
    expect(await screen.findByText("Domanda 2 di 6")).toBeInTheDocument();
    expect(screen.queryByText("Sequenza completata.")).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("completes the sequence only after all 6 items are confirmed", async () => {
    const onComplete = vi.fn();
    render(
      <SequenceHost
        definition={WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche2-runtime-2"
        stageConfigs={TR2_STAGE_CONFIGS}
        titleKey="quickQuestionSet.sequenceTitle"
        descriptionKey="quickQuestionSet.sequenceDescription"
        onComplete={onComplete}
      />,
    );
    await screen.findByText("Domanda 1 di 6");
    fireEvent.click(screen.getByRole("button", { name: "Sottraggo 5 a entrambi i membri" })); // I003 correct
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    await screen.findByText("Domanda 2 di 6");
    fireEvent.click(screen.getByRole("button", { name: "Divido entrambi i membri per 3" })); // I004 correct
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    const numericAnswers = [13, 6, 4, 5]; // I006, I007, I009, I010 — all correct
    for (const [index, value] of numericAnswers.entries()) {
      await screen.findByText(`Domanda ${index + 3} di 6`);
      const input = screen.getByRole("spinbutton") as HTMLInputElement;
      fireEvent.change(input, { target: { value: String(value) } });
      fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));
    }

    expect(await screen.findByText("Sequenza completata.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

/**
 * M06 Web Full Vertical Slice Tranche 3 (`07_26 v1.0` §5/§13): real
 * `PREREQUISITE_CHECK` (2-item `ITEM_SET`, reusing Tranche 2's engine
 * extension) followed by 7 non-interactive `MICRO_LESSON` sub-stages —
 * exercises the `stagePrompts` rendering extended to non-interactive
 * stages (this tranche's own addition to `SequenceHost`) and the full
 * step-reveal "Continua" progression through to sequence completion.
 */
const TR3_STAGE_CONFIGS = { [WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID]: WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG };

describe("SequenceHost — Tranche 3 Prerequisite Check + Micro Lesson (real 2-item ITEM_SET + 7-step non-interactive reveal)", () => {
  it("renders PREREQUISITE_CHECK's two items, then reveals every MICRO_LESSON step's real stagePrompts text via the non-interactive continue button, completing the sequence", async () => {
    const onComplete = vi.fn();
    render(
      <SequenceHost
        definition={WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche3-runtime"
        stageConfigs={TR3_STAGE_CONFIGS}
        stagePrompts={WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS}
        titleKey="prerequisiteCheckMicroLesson.sequenceTitle"
        descriptionKey="prerequisiteCheckMicroLesson.sequenceDescription"
        onComplete={onComplete}
      />,
    );

    // PREREQUISITE_CHECK — I001 then I002, both correct.
    expect(await screen.findByText("Domanda 1 di 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "x + 4 = 9" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    await screen.findByText("Domanda 2 di 2");
    fireEvent.click(screen.getByRole("button", { name: "4x + 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    // MICRO_LESSON: equilibrium explanation, then the six worked-example steps, in order.
    expect(await screen.findByText("Spiegazione visuale")).toBeInTheDocument();
    expect(screen.getByText(/Bilancia visuale con x \+ 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));

    const steps = ["2x + 3 = 11", "2x + 3 - 3 = 11 - 3", "2x = 8", "2x / 2 = 8 / 2", "x = 4", "Verifica: 2(4) + 3 = 11 → 8 + 3 = 11"];
    for (const [index, stepText] of steps.entries()) {
      await screen.findByText(stepText);
      expect(screen.getByText("Esempio guidato")).toBeInTheDocument();
      if (index < steps.length - 1) {
        fireEvent.click(screen.getByRole("button", { name: "Continua" }));
      }
    }

    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));
    expect(await screen.findByText("Sequenza completata.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not skip ahead: after PREREQUISITE_CHECK, only the equilibrium step is visible, not any worked-example step", async () => {
    render(
      <SequenceHost
        definition={WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche3-runtime-2"
        stageConfigs={TR3_STAGE_CONFIGS}
        stagePrompts={WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS}
        titleKey="prerequisiteCheckMicroLesson.sequenceTitle"
        descriptionKey="prerequisiteCheckMicroLesson.sequenceDescription"
      />,
    );
    await screen.findByText("Domanda 1 di 2");
    fireEvent.click(screen.getByRole("button", { name: "x + 4 = 9" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));
    await screen.findByText("Domanda 2 di 2");
    fireEvent.click(screen.getByRole("button", { name: "4x + 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma soluzione" }));

    expect(await screen.findByText("Spiegazione visuale")).toBeInTheDocument();
    expect(screen.queryByText("2x + 3 = 11")).not.toBeInTheDocument();
  });
});

/**
 * M06 Web Full Vertical Slice Tranche 5 (`07_26 v1.1` §13/§17): `INTRO_HOOK`
 * — non-interactive, no engine, real scene rendered via `stageScenes`.
 */
describe("SequenceHost — Tranche 5 INTRO_HOOK", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.mocked(notifyOrchestrationStageEntry).mockClear();
  });

  it("renders the objective chip / mentor dialogue prompt and the Mission Plaza scene, then completes the orchestration-level sequence on Continua", async () => {
    const onComplete = vi.fn();
    const onAction = vi.fn();
    render(
      <SequenceHost
        definition={WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche5-runtime"
        stageConfigs={{}}
        stagePrompts={{
          [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: { titleKey: "introHook.promptTitle", bodyKey: "introHook.promptBody" },
        }}
        stageScenes={{ [WEB_TRANCHE5_INTRO_HOOK_STAGE_ID]: [...WEB_TRANCHE5_INTRO_HOOK_CONTENT.semanticRoles] }}
        titleKey="introHook.sequenceTitle"
        descriptionKey="introHook.sequenceDescription"
        onComplete={onComplete}
        onAction={onAction}
      />,
    );

    expect(await screen.findByText("Mantieni uguali i due membri")).toBeInTheDocument();
    expect(
      screen.getByText("La Balance Machine confronta due lati. Se cambiamo un lato, dobbiamo fare lo stesso sull'altro."),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Piazza della missione, accademia, sfondo statico")).toBeInTheDocument();
    expect(screen.getByAltText("Ritratto del mentore, in posa di attesa")).toBeInTheDocument();

    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));
    expect(await screen.findByText("Sequenza completata.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    // M06 Non-Interactive Attempt Lifecycle (07_15_01 v1.3 §11-bis.2-bis):
    // a wholly non-interactive stage never dispatches to an EngineHost and
    // so still logs no semantic action on Continua — onAction correctly
    // never fires here. The attempt's CREATED -> IN_PROGRESS transition no
    // longer depends on this click at all (no attemptId prop is passed in
    // this test, so notifyOrchestrationStageEntry never fires either) —
    // see the dedicated describe block below for that trigger.
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders no scene at all when stageScenes is not supplied (regression guard for every pre-Tranche-5 sequence)", async () => {
    render(
      <SequenceHost
        definition={WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche5-runtime-no-scene"
        stageConfigs={{}}
        titleKey="introHook.sequenceTitle"
        descriptionKey="introHook.sequenceDescription"
      />,
    );
    await screen.findByText("Stage 1 di 1");
    expect(screen.queryByAltText("Piazza della missione, accademia, sfondo statico")).not.toBeInTheDocument();
  });
});

/**
 * M06 Non-Interactive Attempt Lifecycle (`07_15_01 v1.3` §11-bis.2-bis):
 * `SequenceHost` notifies the new orchestration-stage-entry trigger on
 * entering INTRO_HOOK's single, non-interactive, engine-less stage — never
 * a semantic action, never dependent on the "Continua" click.
 */
describe("SequenceHost — orchestration-stage-entry trigger (INTRO_HOOK)", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.mocked(notifyOrchestrationStageEntry).mockClear();
  });

  it("notifies orchestration-stage-entry once, on mount, when attemptId and a CSRF token are both present", async () => {
    setStoredCsrfToken("test-csrf-token");
    render(
      <SequenceHost
        definition={WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche5-orchestration-trigger"
        attemptId="attempt-test-1"
        stageConfigs={{}}
        titleKey="introHook.sequenceTitle"
        descriptionKey="introHook.sequenceDescription"
      />,
    );
    await screen.findByText("Stage 1 di 1");
    expect(notifyOrchestrationStageEntry).toHaveBeenCalledTimes(1);
    expect(notifyOrchestrationStageEntry).toHaveBeenCalledWith("attempt-test-1", "test-csrf-token");

    // Re-render (e.g. a hint/progress re-render) never re-fires it for the
    // same stage — the ref guard keyed by stageId is a de-dupe against
    // redundant network calls, not a correctness requirement (the server
    // side is idempotent regardless).
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));
    await screen.findByText("Sequenza completata.");
    expect(notifyOrchestrationStageEntry).toHaveBeenCalledTimes(1);
  });

  it("never notifies when attemptId is absent (the unauthenticated /w/sequence demo)", async () => {
    setStoredCsrfToken("test-csrf-token");
    render(
      <SequenceHost
        definition={WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche5-orchestration-trigger-no-attempt"
        stageConfigs={{}}
        titleKey="introHook.sequenceTitle"
        descriptionKey="introHook.sequenceDescription"
      />,
    );
    await screen.findByText("Stage 1 di 1");
    expect(notifyOrchestrationStageEntry).not.toHaveBeenCalled();
  });

  it("never notifies when no CSRF token is stored (unauthenticated session)", async () => {
    render(
      <SequenceHost
        definition={WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche5-orchestration-trigger-no-csrf"
        attemptId="attempt-test-2"
        stageConfigs={{}}
        titleKey="introHook.sequenceTitle"
        descriptionKey="introHook.sequenceDescription"
      />,
    );
    await screen.findByText("Stage 1 di 1");
    expect(notifyOrchestrationStageEntry).not.toHaveBeenCalled();
  });

  it("never notifies for an interactive stage (Tranche 1 GUIDED_PRACTICE, real engine dispatch)", async () => {
    setStoredCsrfToken("test-csrf-token");
    render(
      <SequenceHost
        definition={WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION}
        runtimeStateId="test-tranche1-orchestration-trigger-guard"
        attemptId="attempt-test-3"
        stageConfigs={STAGE_CONFIGS}
        titleKey="guidedPractice.sequenceTitle"
        descriptionKey="guidedPractice.sequenceDescription"
      />,
    );
    await screen.findByText("Domanda rapida (Quick Question)");
    expect(notifyOrchestrationStageEntry).not.toHaveBeenCalled();
  });
});
