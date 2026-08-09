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

const ITEM_SET_CONFIG = {
  mode: "ITEM_SET" as const,
  items: [
    {
      itemId: "IT-1",
      mode: "OPTION_SELECTION" as const,
      prompt: "Which option is correct?",
      options: [
        { optionId: "a", text: "Wrong A" },
        { optionId: "b", text: "Right B" },
        { optionId: "c", text: "Wrong C" },
      ],
      correctOptionId: "b",
      feedback: {
        correctFeedbackText: "Corretto.",
        incorrectFeedbackText: "Riprova.",
        misconceptions: [{ matchChoiceId: "a", code: "MIS-A", feedbackText: "Hai sbagliato per il motivo A." }],
      },
    },
    {
      itemId: "IT-2",
      mode: "ENTER_VALUE" as const,
      prompt: "Risolvi: x + 5 = 12",
      expectedValue: 7,
      tolerance: 0,
      feedback: { correctFeedbackText: "Corretto.", solutionExplanation: "x + 5 - 5 = 12 - 5, quindi x = 7." },
    },
    {
      itemId: "IT-3",
      mode: "ENTER_VALUE" as const,
      prompt: "Risolvi: x = 6",
      expectedValue: 6,
      tolerance: 0,
    },
  ],
};

describe("QuickQuestionEngine — ITEM_SET config validation", () => {
  it("accepts a valid ITEM_SET configuration", () => {
    expect(validateQuickQuestionConfig(ITEM_SET_CONFIG).valid).toBe(true);
  });

  it("rejects ITEM_SET with zero items", () => {
    expect(validateQuickQuestionConfig({ mode: "ITEM_SET", items: [] }).valid).toBe(false);
  });

  it("rejects ITEM_SET with a duplicated itemId", () => {
    const config = {
      mode: "ITEM_SET",
      items: [
        { itemId: "dup", mode: "ENTER_VALUE", expectedValue: 1, tolerance: 0 },
        { itemId: "dup", mode: "ENTER_VALUE", expectedValue: 2, tolerance: 0 },
      ],
    };
    expect(validateQuickQuestionConfig(config).valid).toBe(false);
  });

  it("rejects an ITEM_SET item with an OPTION_SELECTION option missing text", () => {
    const config = {
      mode: "ITEM_SET",
      items: [
        {
          itemId: "i1",
          mode: "OPTION_SELECTION",
          options: [{ optionId: "a" }, { optionId: "b", text: "B" }],
          correctOptionId: "b",
        },
      ],
    };
    expect(validateQuickQuestionConfig(config).valid).toBe(false);
  });
});

describe("QuickQuestionEngine — ITEM_SET flow (Tranche 2, QUICK_QUESTION_SET)", () => {
  const engine = createQuickQuestionEngine();

  it("stays unevaluated until every item in the set has been confirmed", () => {
    const { state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, ITEM_SET_CONFIG);
    expect(result.evaluated).toBe(false);
  });

  it("advances item-to-item strictly in order without an itemIndex in the action payload", () => {
    let state = engine.initState(ITEM_SET_CONFIG);
    ({ state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]));
    expect(state.currentItemIndex).toBe(1);
    expect(state.itemResults).toHaveLength(1);
    expect(state.itemResults?.[0]).toMatchObject({ itemId: "IT-1", correctness: "CORRECT" });
  });

  it("evaluates evaluated:true with aggregate CORRECT once all items are answered correctly", () => {
    const { state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 7 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 6 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, ITEM_SET_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("CORRECT");
      expect(result.score).toBe(1);
    }
  });

  it("still completes the set (non-punitive) and reports aggregate INCORRECT when one item is wrong", () => {
    const { state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "a" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 7 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 6 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, ITEM_SET_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("INCORRECT");
      expect(result.score).toBe(0);
      const evidence = result.evidence as {
        itemResults: Array<{ itemId: string; correctness: string; misconceptionCode?: string }>;
        correctCount: number;
        totalItems: number;
      };
      expect(evidence.correctCount).toBe(2);
      expect(evidence.totalItems).toBe(3);
      expect(evidence.itemResults[0]).toMatchObject({ itemId: "IT-1", correctness: "INCORRECT", misconceptionCode: "MIS-A" });
    }
  });

  it("surfaces the matching misconception feedback text for a wrong OPTION_SELECTION choice", () => {
    const { state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "a" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    expect(state.itemResults?.[0]?.feedbackText).toBe("Hai sbagliato per il motivo A.");
  });

  it("surfaces the solutionExplanation for a wrong ENTER_VALUE item without a per-choice misconception", () => {
    let state = engine.initState(ITEM_SET_CONFIG);
    ({ state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 999 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]));
    expect(state.itemResults?.[1]).toMatchObject({ itemId: "IT-2", correctness: "INCORRECT" });
    expect(state.itemResults?.[1]?.feedbackText).toBe("x + 5 - 5 = 12 - 5, quindi x = 7.");
  });

  it("RESET_STAGE clears item-set progress back to the first item", () => {
    let state = engine.initState(ITEM_SET_CONFIG);
    ({ state } = replayActions(engine, ITEM_SET_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "RESET_STAGE", targetRole: "confirm-button", payload: {} },
    ]));
    expect(state.currentItemIndex).toBeUndefined();
    expect(state.itemResults).toBeUndefined();
    expect(state.confirmed).toBe(false);
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
