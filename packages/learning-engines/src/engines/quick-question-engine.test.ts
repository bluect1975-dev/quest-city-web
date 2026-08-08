import { describe, expect, it } from "vitest";
import { replayActions } from "../engine-runtime";
import {
  QUICK_QUESTION_CANONICAL_ENGINE_ID,
  QUICK_QUESTION_RUNTIME_ADAPTER_ID,
  buildQuickQuestionRegistryEntry,
  createQuickQuestionEngine,
  validateQuickQuestionConfig,
} from "./quick-question-engine";

const OPTION_CONFIG = {
  mode: "OPTION_SELECTION" as const,
  options: [{ optionId: "a" }, { optionId: "b" }, { optionId: "c" }],
  correctOptionId: "b",
};
const NUMERIC_CONFIG = { mode: "ENTER_VALUE" as const, expectedValue: 42, tolerance: 0 };

describe("QuickQuestionEngine — config validation", () => {
  it("accepts a valid OPTION_SELECTION configuration", () => {
    expect(validateQuickQuestionConfig(OPTION_CONFIG).valid).toBe(true);
  });

  it("accepts a valid ENTER_VALUE configuration", () => {
    expect(validateQuickQuestionConfig(NUMERIC_CONFIG).valid).toBe(true);
  });

  it("rejects OPTION_SELECTION with fewer than 2 options", () => {
    expect(validateQuickQuestionConfig({ mode: "OPTION_SELECTION", options: [{ optionId: "a" }], correctOptionId: "a" }).valid).toBe(false);
  });

  it("rejects OPTION_SELECTION whose correctOptionId is not among options", () => {
    expect(
      validateQuickQuestionConfig({
        mode: "OPTION_SELECTION",
        options: [{ optionId: "a" }, { optionId: "b" }],
        correctOptionId: "z",
      }).valid,
    ).toBe(false);
  });

  it("rejects ENTER_VALUE with a non-numeric expectedValue", () => {
    expect(validateQuickQuestionConfig({ mode: "ENTER_VALUE", expectedValue: "42" }).valid).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(validateQuickQuestionConfig({ mode: "SOMETHING_ELSE" }).valid).toBe(false);
  });
});

describe("QuickQuestionEngine — OPTION_SELECTION flow", () => {
  const engine = createQuickQuestionEngine();

  it("SELECT_OPTION then CONFIRM_SOLUTION scores CORRECT for the right option", () => {
    const { state } = replayActions(engine, OPTION_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, OPTION_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("CORRECT");
  });

  it("scores INCORRECT for the wrong option", () => {
    const { state } = replayActions(engine, OPTION_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "a" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, OPTION_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("INCORRECT");
  });

  it("rejects SELECT_OPTION for an unknown optionId", () => {
    const state = engine.initState(OPTION_CONFIG);
    const outcome = engine.applyAction(state, OPTION_CONFIG, {
      actionType: "SELECT_OPTION",
      targetRole: "option",
      payload: { optionId: "does-not-exist" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("ENTER_VALUE is invalid for an OPTION_SELECTION configuration", () => {
    const state = engine.initState(OPTION_CONFIG);
    const outcome = engine.applyAction(state, OPTION_CONFIG, {
      actionType: "ENTER_VALUE",
      targetRole: "value-input",
      payload: { value: 1 },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("CONFIRM_SOLUTION with no selection is rejected", () => {
    const state = engine.initState(OPTION_CONFIG);
    const outcome = engine.applyAction(state, OPTION_CONFIG, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    });
    expect(outcome.accepted).toBe(false);
  });
});

describe("QuickQuestionEngine — ENTER_VALUE (simple numeric) flow", () => {
  const engine = createQuickQuestionEngine();

  it("scores CORRECT for an exact match with zero tolerance", () => {
    const { state } = replayActions(engine, NUMERIC_CONFIG, [
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 42 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, NUMERIC_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("CORRECT");
  });

  it("scores INCORRECT outside tolerance", () => {
    const { state } = replayActions(engine, NUMERIC_CONFIG, [
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 43 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, NUMERIC_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("INCORRECT");
  });

  it("scores CORRECT within a non-zero tolerance", () => {
    const config = { mode: "ENTER_VALUE" as const, expectedValue: 42, tolerance: 1 };
    const { state } = replayActions(engine, config, [
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 42.5 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, config);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("CORRECT");
  });

  it("rejects ENTER_VALUE with a non-numeric payload (malformed input never scores)", () => {
    const state = engine.initState(NUMERIC_CONFIG);
    const outcome = engine.applyAction(state, NUMERIC_CONFIG, {
      actionType: "ENTER_VALUE",
      targetRole: "value-input",
      payload: { value: "not-a-number" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("SELECT_OPTION is invalid for an ENTER_VALUE configuration", () => {
    const state = engine.initState(NUMERIC_CONFIG);
    const outcome = engine.applyAction(state, NUMERIC_CONFIG, {
      actionType: "SELECT_OPTION",
      targetRole: "option",
      payload: { optionId: "a" },
    });
    expect(outcome.accepted).toBe(false);
  });
});

describe("QuickQuestionEngine — numeric boundary test (§53)", () => {
  /**
   * Confirms explicitly, in a dedicated test (per R3C.1 instructions §53),
   * that ENG-QUICK/QuickQuestionEngine's ENTER_VALUE mode CAN satisfy a
   * simple numeric activity through its own configuration — and that this
   * is achieved without registering QC-WEB-ENGINE-NUMERIC-INPUT, which
   * remains unregistered (PROPOSED, P1) in this phase.
   */
  it("a simple single-value numeric activity is fully satisfiable by ENG-QUICK's own ENTER_VALUE mode", () => {
    const engine = createQuickQuestionEngine();
    expect(engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    expect(engine.runtimeAdapterId).not.toBe("QC-WEB-ENGINE-NUMERIC-INPUT");
    const config = { mode: "ENTER_VALUE" as const, expectedValue: 7, tolerance: 0 };
    const validation = validateQuickQuestionConfig(config);
    expect(validation.valid).toBe(true);
    const { state } = replayActions(engine, config, [
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 7 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, config);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("CORRECT");
  });
});

describe("QuickQuestionEngine — identity and registry entry", () => {
  it("declares the ratified R3C.0A identity", () => {
    const engine = createQuickQuestionEngine();
    expect(engine.canonicalEngineId).toBe(QUICK_QUESTION_CANONICAL_ENGINE_ID);
    expect(engine.runtimeAdapterId).toBe(QUICK_QUESTION_RUNTIME_ADAPTER_ID);
    expect(engine.canonicalEngineId).toBe("ENG-QUICK");
    expect(engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
  });

  it("builds a registry entry matching declared semantic actions", () => {
    const entry = buildQuickQuestionRegistryEntry();
    expect(entry.semanticActions).toContain("SELECT_OPTION");
    expect(entry.semanticActions).toContain("ENTER_VALUE");
    expect(entry.runtimeAdapters).toEqual([{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" }]);
  });
});
